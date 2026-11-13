//! Append-only store of zstd-compressed messages in pack files.

use crate::model::MessageRef;
use crate::paths::{create_private_dir, create_private_file};
use crate::{Error, Result};
use std::fs::File;
use std::io::{Seek, SeekFrom};
use std::os::unix::fs::FileExt;
use std::path::{Path, PathBuf};

const DEFAULT_PACK_LIMIT: u64 = 1 << 30;
const ZSTD_LEVEL: i32 = 3;

pub struct Store {
    dir: PathBuf,
    pack_limit: u64,
    pack_id: u32,
    file: File,
    len: u64,
}

fn pack_path(dir: &Path, id: u32) -> PathBuf {
    dir.join(format!("pack-{id:05}.zst"))
}

impl Store {
    /// Open (creating if needed) the store under `dir/store`.
    pub fn open(dir: &Path) -> Result<Store> {
        Self::open_with_limit(dir, DEFAULT_PACK_LIMIT)
    }

    pub(crate) fn open_with_limit(dir: &Path, pack_limit: u64) -> Result<Store> {
        let dir = dir.join("store");
        create_private_dir(&dir)?;
        let mut pack_id = 0;
        for entry in std::fs::read_dir(&dir)? {
            let name = entry?.file_name();
            let id = name
                .to_str()
                .and_then(|n| n.strip_prefix("pack-"))
                .and_then(|n| n.strip_suffix(".zst"))
                .and_then(|n| n.parse::<u32>().ok());
            if let Some(id) = id {
                pack_id = pack_id.max(id);
            }
        }
        let mut file = create_private_file(&pack_path(&dir, pack_id))?;
        let len = file.seek(SeekFrom::End(0))?;
        Ok(Store {
            dir,
            pack_limit,
            pack_id,
            file,
            len,
        })
    }

    /// Compress `bytes` as one zstd frame and append it.
    pub fn append(&mut self, bytes: &[u8]) -> Result<MessageRef> {
        let frame = zstd::bulk::compress(bytes, ZSTD_LEVEL)?;
        let length = u32::try_from(frame.len())
            .map_err(|_| Error::Store("compressed message exceeds 4 GiB".into()))?;
        if self.len > 0 && self.len + frame.len() as u64 > self.pack_limit {
            self.file.sync_data()?;
            let id = self.pack_id + 1;
            let file = create_private_file(&pack_path(&self.dir, id))?;
            let len = file.metadata()?.len();
            self.file = file;
            self.pack_id = id;
            self.len = len;
        }
        let offset = self.len;
        // Positional write: a failed or short write never desyncs the cursor
        // from `self.len`; the next append overwrites any partial bytes.
        self.file.write_all_at(&frame, offset)?;
        self.len += frame.len() as u64;
        Ok(MessageRef {
            pack_id: self.pack_id,
            offset,
            length,
        })
    }

    /// Read and decompress one message. Safe to call concurrently.
    ///
    /// A frame that is cut short or does not decode is [`Error::Store`]
    /// (corruption of that one message); a failure of the file itself
    /// (missing pack, permissions, EIO, ...) is [`Error::Io`].
    pub fn read(&self, r: MessageRef) -> Result<Vec<u8>> {
        let file = File::open(pack_path(&self.dir, r.pack_id))?;
        let mut frame = vec![0u8; r.length as usize];
        match file.read_exact_at(&mut frame, r.offset) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                return Err(Error::Store("message frame is truncated".into()));
            }
            Err(e) => return Err(e.into()),
        }
        zstd::stream::decode_all(&frame[..])
            .map_err(|_| Error::Store("message frame could not be decoded".into()))
    }

    /// Flush appended data to disk.
    pub fn sync(&mut self) -> Result<()> {
        self.file.sync_data()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    /// Deterministic incompressible-ish bytes.
    fn noise(seed: u64, n: usize) -> Vec<u8> {
        let mut x = seed.wrapping_mul(0x9E3779B97F4A7C15) | 1;
        (0..n)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                (x >> 24) as u8
            })
            .collect()
    }

    #[test]
    fn append_read_roundtrip() {
        let t = tempfile::tempdir().unwrap();
        let mut s = Store::open(t.path()).unwrap();
        let mut refs = Vec::new();
        for i in 0..1000u64 {
            let m = if i % 2 == 0 {
                noise(i, (i as usize * 37) % 5000)
            } else {
                vec![b'a'; (i as usize * 13) % 9000]
            };
            refs.push((s.append(&m).unwrap(), m));
        }
        s.sync().unwrap();
        for (r, m) in &refs {
            assert_eq!(&s.read(*r).unwrap(), m);
        }
    }

    #[test]
    fn rolls_to_new_pack() {
        let t = tempfile::tempdir().unwrap();
        let mut s = Store::open_with_limit(t.path(), 1 << 20).unwrap();
        let msgs: Vec<_> = (0..5).map(|i| noise(i, 600_000)).collect();
        let refs: Vec<_> = msgs.iter().map(|m| s.append(m).unwrap()).collect();
        let ids: Vec<_> = refs.iter().map(|r| r.pack_id).collect();
        assert_eq!(ids, [0, 1, 2, 3, 4]);
        for (r, m) in refs.iter().zip(&msgs) {
            assert_eq!(&s.read(*r).unwrap(), m);
        }
        // three MB spread over exactly packs 0..=2 with smaller messages
        let t = tempfile::tempdir().unwrap();
        let mut s = Store::open_with_limit(t.path(), 1 << 20).unwrap();
        let ids: Vec<_> = (0..3)
            .map(|i| s.append(&noise(i, 1_000_000)).unwrap().pack_id)
            .collect();
        assert_eq!(ids, [0, 1, 2]);
    }

    #[test]
    fn reopen_appends_after_existing() {
        let t = tempfile::tempdir().unwrap();
        let a = noise(1, 1000);
        let b = noise(2, 2000);
        let ra = {
            let mut s = Store::open(t.path()).unwrap();
            let r = s.append(&a).unwrap();
            s.sync().unwrap();
            r
        };
        let mut s = Store::open(t.path()).unwrap();
        let rb = s.append(&b).unwrap();
        assert_eq!(ra.pack_id, rb.pack_id);
        assert!(rb.offset >= ra.offset + ra.length as u64);
        assert_eq!(s.read(ra).unwrap(), a);
        assert_eq!(s.read(rb).unwrap(), b);
    }

    #[test]
    fn reopen_continues_in_last_pack() {
        let t = tempfile::tempdir().unwrap();
        let mut s = Store::open_with_limit(t.path(), 1 << 20).unwrap();
        for i in 0..3 {
            s.append(&noise(i, 700_000)).unwrap();
        }
        drop(s);
        let mut s = Store::open_with_limit(t.path(), 1 << 20).unwrap();
        assert_eq!(s.append(b"x").unwrap().pack_id, 2);
    }

    #[test]
    fn crash_tail_is_skipped_on_reopen() {
        use std::io::Write;
        let t = tempfile::tempdir().unwrap();
        let a = noise(1, 1000);
        let b = noise(2, 1000);
        let ra = {
            let mut s = Store::open(t.path()).unwrap();
            let r = s.append(&a).unwrap();
            s.sync().unwrap();
            r
        };
        let pack = t.path().join("store/pack-00000.zst");
        let mut f = std::fs::OpenOptions::new()
            .append(true)
            .open(&pack)
            .unwrap();
        f.write_all(&[0xAB; 77]).unwrap();
        let garbage_end = std::fs::metadata(&pack).unwrap().len();
        let mut s = Store::open(t.path()).unwrap();
        let rb = s.append(&b).unwrap();
        assert!(rb.offset >= garbage_end);
        assert_eq!(s.read(ra).unwrap(), a);
        assert_eq!(s.read(rb).unwrap(), b);
    }

    #[test]
    fn failed_write_does_not_desync_offsets() {
        use std::io::Write;
        let t = tempfile::tempdir().unwrap();
        let mut s = Store::open(t.path()).unwrap();
        let a = noise(1, 500);
        let ra = s.append(&a).unwrap();
        // Simulate a partial write that moved the cursor but not `len`.
        s.file.seek(SeekFrom::End(0)).unwrap();
        s.file.write_all(&[0xCD; 33]).unwrap();
        let b = noise(2, 500);
        let rb = s.append(&b).unwrap();
        assert_eq!(rb.offset, ra.offset + ra.length as u64);
        assert_eq!(s.read(ra).unwrap(), a);
        assert_eq!(s.read(rb).unwrap(), b);
    }

    #[test]
    fn large_message() {
        let t = tempfile::tempdir().unwrap();
        let mut s = Store::open(t.path()).unwrap();
        let m = noise(7, 30 * 1024 * 1024);
        let r = s.append(&m).unwrap();
        assert_eq!(s.read(r).unwrap(), m);
    }

    #[test]
    fn concurrent_reads() {
        let t = tempfile::tempdir().unwrap();
        let mut s = Store::open(t.path()).unwrap();
        let msgs: Vec<_> = (0..50).map(|i| noise(i, 3000 + i as usize)).collect();
        let refs: Vec<_> = msgs.iter().map(|m| s.append(m).unwrap()).collect();
        let s = &s;
        std::thread::scope(|sc| {
            for _ in 0..4 {
                sc.spawn(|| {
                    for (r, m) in refs.iter().zip(&msgs).rev() {
                        assert_eq!(&s.read(*r).unwrap(), m);
                    }
                });
            }
        });
    }

    #[test]
    fn files_are_private() {
        let t = tempfile::tempdir().unwrap();
        let mut s = Store::open(t.path()).unwrap();
        s.append(b"hello").unwrap();
        let dir = t.path().join("store");
        assert_eq!(
            std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777,
            0o700
        );
        let pack = dir.join("pack-00000.zst");
        assert_eq!(
            std::fs::metadata(pack).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}
