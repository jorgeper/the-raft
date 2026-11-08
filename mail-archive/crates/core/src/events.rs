//! Append-only event log (newline-delimited JSON). Together with the store it
//! is the source of truth; SQLite and the search index are rebuildable caches.

use std::collections::{BTreeMap, HashSet};
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::model::{ImportKind, Key, MessageRef};
use crate::paths::create_private_file;
use crate::{Error, Result};

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
pub enum Event {
    ImportStarted {
        import_id: u64,
        at: i64,
        source: String,
        kind: ImportKind,
    },
    MessageAdded {
        import_id: u64,
        #[serde(with = "hex_key")]
        content_key: Key,
        #[serde(with = "hex_opt_key")]
        header_key: Option<Key>,
        msg_ref: MessageRef,
        labels: Vec<String>,
        /// The mbox `From ` line date, which the stored bytes lack; parsing
        /// needs it for messages without a usable `Date` header.
        #[serde(default)]
        from_line_date: Option<i64>,
    },
    LabelsChanged {
        import_id: u64,
        #[serde(with = "hex_key")]
        content_key: Key,
        labels: Vec<String>,
    },
    /// `removed` holds the content keys of ALL library messages absent from
    /// this (full) import, not just the newly absent ones.
    ImportCompleted {
        import_id: u64,
        at: i64,
        #[serde(with = "hex_keys")]
        removed: Vec<Key>,
    },
    /// An interrupted import was removed from SQLite and the index. Its
    /// events (this one included) are ignored by [`completed_events`].
    ImportRolledBack { import_id: u64, at: i64 },
}

/// How far an import got, according to the log.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum LogState {
    /// Has events but neither `ImportCompleted` nor `ImportRolledBack`.
    Open,
    Completed,
    RolledBack,
}

impl Event {
    pub fn import_id(&self) -> u64 {
        match self {
            Event::ImportStarted { import_id, .. }
            | Event::MessageAdded { import_id, .. }
            | Event::LabelsChanged { import_id, .. }
            | Event::ImportCompleted { import_id, .. }
            | Event::ImportRolledBack { import_id, .. } => *import_id,
        }
    }
}

fn to_hex(k: &Key) -> String {
    k.iter().map(|b| format!("{b:02x}")).collect()
}

fn from_hex(s: &str) -> std::result::Result<Key, String> {
    if s.len() != 64 || !s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
        return Err("key must be 64 lowercase hex characters".into());
    }
    let mut k = [0u8; 32];
    for (i, b) in k.iter_mut().enumerate() {
        *b = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).map_err(|e| e.to_string())?;
    }
    Ok(k)
}

mod hex_key {
    use super::*;
    use serde::{Deserializer, Serializer, de::Error as _};

    pub fn serialize<S: Serializer>(k: &Key, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&to_hex(k))
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> std::result::Result<Key, D::Error> {
        from_hex(&String::deserialize(d)?).map_err(D::Error::custom)
    }
}

mod hex_opt_key {
    use super::*;
    use serde::{Deserializer, Serializer, de::Error as _};

    pub fn serialize<S: Serializer>(k: &Option<Key>, s: S) -> std::result::Result<S::Ok, S::Error> {
        match k {
            Some(k) => s.serialize_some(&to_hex(k)),
            None => s.serialize_none(),
        }
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(
        d: D,
    ) -> std::result::Result<Option<Key>, D::Error> {
        Option::<String>::deserialize(d)?
            .map(|s| from_hex(&s).map_err(D::Error::custom))
            .transpose()
    }
}

mod hex_keys {
    use super::*;
    use serde::{Deserializer, Serializer, de::Error as _};

    pub fn serialize<S: Serializer>(ks: &[Key], s: S) -> std::result::Result<S::Ok, S::Error> {
        s.collect_seq(ks.iter().map(to_hex))
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> std::result::Result<Vec<Key>, D::Error> {
        Vec::<String>::deserialize(d)?
            .iter()
            .map(|s| from_hex(s).map_err(D::Error::custom))
            .collect()
    }
}

/// Offset of the last `\n` in `file[..end]`, scanning backwards in chunks.
fn last_newline_before(file: &mut File, end: u64) -> Result<Option<u64>> {
    const CHUNK: u64 = 8192;
    let mut end = end;
    let mut buf = vec![0u8; CHUNK as usize];
    while end > 0 {
        let start = end.saturating_sub(CHUNK);
        let n = (end - start) as usize;
        file.seek(SeekFrom::Start(start))?;
        file.read_exact(&mut buf[..n])?;
        if let Some(i) = buf[..n].iter().rposition(|&b| b == b'\n') {
            return Ok(Some(start + i as u64));
        }
        end = start;
    }
    Ok(None)
}

/// An event exists only if its line is complete (ends in `\n`) and parses.
/// Returns the length of the log up to the end of the last such line,
/// looking only at the final one or two lines.
fn valid_prefix_len(file: &mut File, len: u64) -> Result<u64> {
    // End of the last complete line.
    let Some(nl) = last_newline_before(file, len)? else {
        return Ok(0);
    };
    let end = nl + 1;
    let start = last_newline_before(file, nl)?.map_or(0, |p| p + 1);
    let mut line = vec![0u8; (nl - start) as usize];
    file.seek(SeekFrom::Start(start))?;
    file.read_exact(&mut line)?;
    if line.iter().all(u8::is_ascii_whitespace) || serde_json::from_slice::<Event>(&line).is_ok() {
        Ok(end)
    } else {
        Ok(start)
    }
}

pub struct EventLog {
    file: File,
}

impl EventLog {
    /// Open (creating with mode 0600 if missing) for appending. Truncates the
    /// file to the end of the last complete line that parses, dropping an
    /// unterminated tail or a malformed final line left by a crash.
    pub fn open(path: &Path) -> Result<EventLog> {
        drop(create_private_file(path)?);
        let mut file = OpenOptions::new().read(true).append(true).open(path)?;
        let len = file.metadata()?.len();
        let keep = valid_prefix_len(&mut file, len)?;
        if keep != len {
            file.set_len(keep)?;
            file.sync_all()?;
        }
        Ok(EventLog { file })
    }

    pub fn append(&mut self, e: &Event) -> Result<()> {
        let mut line = serde_json::to_vec(e).map_err(|e| Error::Events(e.to_string()))?;
        line.push(b'\n');
        let before = self.file.metadata()?.len();
        // One write call so a line is never interleaved with another.
        if let Err(err) = self.file.write_all(&line) {
            // A partial write (e.g. ENOSPC) must not leave a torn line behind.
            let _ = self.file.set_len(before);
            return Err(err.into());
        }
        Ok(())
    }

    pub fn sync(&mut self) -> Result<()> {
        self.file.sync_all()?;
        Ok(())
    }

    /// Id of the newest `ImportCompleted`, scanning back from the end (cheap
    /// when the log ends with one; otherwise it walks back past the events of
    /// the rolled-back or open imports after it).
    pub fn last_completed_import(&mut self) -> Result<Option<u64>> {
        let mut end = self.file.metadata()?.len();
        while let Some(nl) = last_newline_before(&mut self.file, end)? {
            let start = last_newline_before(&mut self.file, nl)?.map_or(0, |p| p + 1);
            end = start;
            let mut line = vec![0u8; (nl - start) as usize];
            self.file.seek(SeekFrom::Start(start))?;
            self.file.read_exact(&mut line)?;
            if line.windows(15).any(|w| w == b"ImportCompleted")
                && let Ok(Event::ImportCompleted { import_id, .. }) = serde_json::from_slice(&line)
            {
                return Ok(Some(import_id));
            }
        }
        Ok(None)
    }

    /// The last event in the log, reading only the tail of the file.
    pub fn last_event(&mut self) -> Result<Option<Event>> {
        let mut end = self.file.metadata()?.len();
        loop {
            let Some(nl) = last_newline_before(&mut self.file, end)? else {
                return Ok(None);
            };
            let start = last_newline_before(&mut self.file, nl)?.map_or(0, |p| p + 1);
            let mut line = vec![0u8; (nl - start) as usize];
            self.file.seek(SeekFrom::Start(start))?;
            self.file.read_exact(&mut line)?;
            if line.iter().all(u8::is_ascii_whitespace) {
                end = start;
                continue;
            }
            return serde_json::from_slice(&line)
                .map(Some)
                .map_err(|e| Error::Events(format!("corrupt last line: {e}")));
        }
    }
}

/// Read all events, streaming line by line. An event exists only if its line
/// ends in `\n` and parses: an unterminated final line (valid or not) and a
/// malformed terminated final line are ignored; a malformed earlier line is
/// corruption and an error.
pub fn read_events(path: &Path) -> Result<Vec<Event>> {
    let mut events = Vec::new();
    for_each_event(path, |e| events.push(e))?;
    Ok(events)
}

/// The state of every import that has events in the log, streaming the log
/// without keeping the events.
pub fn import_states(path: &Path) -> Result<BTreeMap<u64, LogState>> {
    let mut states = BTreeMap::new();
    for_each_event(path, |e| {
        let st = states.entry(e.import_id()).or_insert(LogState::Open);
        match e {
            Event::ImportCompleted { .. } => *st = LogState::Completed,
            Event::ImportRolledBack { .. } => *st = LogState::RolledBack,
            _ => {}
        }
    })?;
    Ok(states)
}

fn for_each_event(path: &Path, mut f: impl FnMut(Event)) -> Result<()> {
    try_for_each_event(path, |e| {
        f(e);
        Ok(())
    })
}

/// Stream the events of the log in order (same validity rules as
/// [`read_events`]) without collecting them. `f` may stop the walk with an error.
pub fn try_for_each_event(path: &Path, mut f: impl FnMut(Event) -> Result<()>) -> Result<()> {
    let mut reader = BufReader::new(File::open(path)?);
    let mut buf = Vec::new();
    let mut lineno = 0usize;
    loop {
        buf.clear();
        if reader.read_until(b'\n', &mut buf)? == 0 {
            break;
        }
        lineno += 1;
        if buf.last() != Some(&b'\n') {
            break; // unterminated final line: incomplete write
        }
        let body = &buf[..buf.len() - 1];
        if body.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        match serde_json::from_slice::<Event>(body) {
            Ok(e) => f(e)?,
            Err(err) => {
                // Last line = nothing follows it in the file.
                if reader.fill_buf()?.is_empty() {
                    break;
                }
                return Err(Error::Events(format!("corrupt line {lineno}: {err}")));
            }
        }
    }
    Ok(())
}

/// Drop every event of imports that never reached `ImportCompleted`.
pub fn completed_events(all: Vec<Event>) -> Vec<Event> {
    let done: HashSet<u64> = all
        .iter()
        .filter_map(|e| match e {
            Event::ImportCompleted { import_id, .. } => Some(*import_id),
            _ => None,
        })
        .collect();
    all.into_iter()
        .filter(|e| done.contains(&e.import_id()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn k(n: u8) -> Key {
        [n; 32]
    }

    fn mref() -> MessageRef {
        MessageRef {
            pack_id: 1,
            offset: 42,
            length: 7,
        }
    }

    fn all_variants() -> Vec<Event> {
        vec![
            Event::ImportStarted {
                import_id: 1,
                at: 100,
                source: "a.mbox".into(),
                kind: ImportKind::Full,
            },
            Event::MessageAdded {
                import_id: 1,
                content_key: k(1),
                header_key: Some(k(2)),
                msg_ref: mref(),
                from_line_date: None,
                labels: vec!["Inbox".into()],
            },
            Event::MessageAdded {
                import_id: 1,
                content_key: k(3),
                header_key: None,
                msg_ref: mref(),
                from_line_date: None,
                labels: vec![],
            },
            Event::LabelsChanged {
                import_id: 1,
                content_key: k(1),
                labels: vec!["Sent".into()],
            },
            Event::ImportCompleted {
                import_id: 1,
                at: 200,
                removed: vec![k(9), k(10)],
            },
            Event::ImportRolledBack {
                import_id: 2,
                at: 300,
            },
        ]
    }

    fn write_all(path: &Path, evs: &[Event]) {
        let mut log = EventLog::open(path).unwrap();
        for e in evs {
            log.append(e).unwrap();
        }
        log.sync().unwrap();
    }

    #[test]
    fn roundtrip_all_variants() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("events.log");
        let evs = all_variants();
        write_all(&p, &evs);
        assert_eq!(read_events(&p).unwrap(), evs);
        let text = std::fs::read_to_string(&p).unwrap();
        assert!(text.contains(&"01".repeat(32)));
        assert_eq!(text.lines().count(), evs.len());
    }

    #[test]
    fn torn_last_line_ignored() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("events.log");
        let evs = all_variants();
        write_all(&p, &evs);
        let mut f = OpenOptions::new().append(true).open(&p).unwrap();
        f.write_all(b"{\"MessageAdded\":{\"import_id\":2,\"conte")
            .unwrap();
        drop(f);
        assert_eq!(read_events(&p).unwrap(), evs);
    }

    #[test]
    fn torn_tail_truncated_on_open() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("events.log");
        let evs = all_variants();
        write_all(&p, &evs[..2]);
        let mut f = OpenOptions::new().append(true).open(&p).unwrap();
        f.write_all(b"{\"Import").unwrap();
        drop(f);
        let mut log = EventLog::open(&p).unwrap();
        log.append(&evs[2]).unwrap();
        assert_eq!(read_events(&p).unwrap(), evs[..3].to_vec());
    }

    #[test]
    fn torn_only_line_truncated_to_empty() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("events.log");
        std::fs::write(&p, b"{\"Imp").unwrap();
        let mut log = EventLog::open(&p).unwrap();
        log.append(&all_variants()[0]).unwrap();
        assert_eq!(read_events(&p).unwrap(), all_variants()[..1].to_vec());
    }

    fn line_of(e: &Event) -> Vec<u8> {
        serde_json::to_vec(e).unwrap()
    }

    #[test]
    fn unterminated_valid_final_line_ignored_by_read_and_open() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("events.log");
        let evs = all_variants();
        write_all(&p, &evs[..2]);
        let mut f = OpenOptions::new().append(true).open(&p).unwrap();
        f.write_all(&line_of(&evs[4])).unwrap(); // no trailing \n
        drop(f);
        assert_eq!(read_events(&p).unwrap(), evs[..2].to_vec());
        let mut log = EventLog::open(&p).unwrap();
        log.append(&evs[2]).unwrap();
        assert_eq!(
            read_events(&p).unwrap(),
            vec![evs[0].clone(), evs[1].clone(), evs[2].clone()]
        );
    }

    #[test]
    fn malformed_terminated_final_line_truncated_on_open() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("events.log");
        let evs = all_variants();
        write_all(&p, &evs[..2]);
        let mut f = OpenOptions::new().append(true).open(&p).unwrap();
        f.write_all(b"{\"garbage\n").unwrap();
        drop(f);
        assert_eq!(read_events(&p).unwrap(), evs[..2].to_vec());
        let mut log = EventLog::open(&p).unwrap();
        log.append(&evs[2]).unwrap();
        assert_eq!(read_events(&p).unwrap(), evs[..3].to_vec());
    }

    #[test]
    fn torn_tail_longer_than_one_chunk() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("events.log");
        let evs = all_variants();
        write_all(&p, &evs[..2]);
        let mut f = OpenOptions::new().append(true).open(&p).unwrap();
        f.write_all(&vec![b'x'; 20_000]).unwrap();
        drop(f);
        let mut log = EventLog::open(&p).unwrap();
        log.append(&evs[2]).unwrap();
        assert_eq!(read_events(&p).unwrap(), evs[..3].to_vec());
        // Same with a long malformed terminated final line.
        let mut f = OpenOptions::new().append(true).open(&p).unwrap();
        f.write_all(&vec![b'y'; 20_000]).unwrap();
        f.write_all(b"\n").unwrap();
        drop(f);
        let mut log = EventLog::open(&p).unwrap();
        log.append(&evs[3]).unwrap();
        assert_eq!(read_events(&p).unwrap(), evs[..4].to_vec());
    }

    #[test]
    fn corrupt_middle_line_is_error() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("events.log");
        let evs = all_variants();
        let mut s = String::new();
        s.push_str(&serde_json::to_string(&evs[0]).unwrap());
        s.push_str("\nnot json\n");
        s.push_str(&serde_json::to_string(&evs[1]).unwrap());
        s.push('\n');
        std::fs::write(&p, s).unwrap();
        assert!(matches!(read_events(&p), Err(Error::Events(_))));
    }

    #[test]
    fn incomplete_import_dropped() {
        let k1 = k(1);
        let evs = vec![
            Event::ImportStarted {
                import_id: 1,
                at: 1,
                source: "a".into(),
                kind: ImportKind::Partial,
            },
            Event::MessageAdded {
                import_id: 1,
                content_key: k1,
                header_key: None,
                msg_ref: mref(),
                from_line_date: None,
                labels: vec![],
            },
            Event::ImportCompleted {
                import_id: 1,
                at: 2,
                removed: vec![],
            },
            Event::ImportStarted {
                import_id: 2,
                at: 3,
                source: "b".into(),
                kind: ImportKind::Full,
            },
            Event::MessageAdded {
                import_id: 2,
                content_key: k(2),
                header_key: None,
                msg_ref: mref(),
                from_line_date: None,
                labels: vec![],
            },
            Event::MessageAdded {
                import_id: 2,
                content_key: k(3),
                header_key: None,
                msg_ref: mref(),
                from_line_date: None,
                labels: vec![],
            },
        ];
        let mut evs = evs;
        evs.push(Event::ImportRolledBack {
            import_id: 2,
            at: 4,
        });
        let kept = completed_events(evs.clone());
        assert_eq!(kept, evs[..3].to_vec());
    }

    #[test]
    fn import_states_track_outcomes() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("events.log");
        let started = |id| Event::ImportStarted {
            import_id: id,
            at: 0,
            source: "s".into(),
            kind: ImportKind::Full,
        };
        write_all(
            &p,
            &[
                started(1),
                Event::ImportCompleted {
                    import_id: 1,
                    at: 1,
                    removed: vec![],
                },
                started(2),
                Event::ImportRolledBack {
                    import_id: 2,
                    at: 2,
                },
                started(3),
                started(4),
            ],
        );
        let st = import_states(&p).unwrap();
        assert_eq!(
            st.into_iter().collect::<Vec<_>>(),
            vec![
                (1, LogState::Completed),
                (2, LogState::RolledBack),
                (3, LogState::Open),
                (4, LogState::Open)
            ]
        );
    }

    #[test]
    fn file_is_private() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("events.log");
        drop(EventLog::open(&p).unwrap());
        assert_eq!(
            std::fs::metadata(&p).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn last_event_reads_tail() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("events.log");
        let mut log = EventLog::open(&p).unwrap();
        assert_eq!(log.last_event().unwrap(), None);
        let evs = all_variants();
        for e in &evs[..2] {
            log.append(e).unwrap();
        }
        assert_eq!(log.last_event().unwrap().as_ref(), Some(&evs[1]));
        log.append(&evs[4]).unwrap();
        // Blank trailing lines are skipped.
        let mut f = OpenOptions::new().append(true).open(&p).unwrap();
        f.write_all(b"\n  \n").unwrap();
        drop(f);
        assert_eq!(log.last_event().unwrap().as_ref(), Some(&evs[4]));
        // Appending still goes to the end after the tail was read.
        log.append(&evs[2]).unwrap();
        assert_eq!(log.last_event().unwrap().as_ref(), Some(&evs[2]));
        let read = read_events(&p).unwrap();
        assert_eq!(
            read,
            vec![
                evs[0].clone(),
                evs[1].clone(),
                evs[4].clone(),
                evs[2].clone()
            ]
        );
    }

    #[test]
    fn reopen_appends() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("events.log");
        let evs = all_variants();
        write_all(&p, &evs[..2]);
        write_all(&p, &evs[2..]);
        assert_eq!(read_events(&p).unwrap(), evs);
    }
}
