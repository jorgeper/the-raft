//! Streaming mboxrd reader.
//!
//! A message starts at a line beginning `From ` that follows an empty line (or
//! the start of the file). The blank line separating messages is not part of
//! the message. `\r\n` and `\n` line endings are both recognised; message
//! bytes are otherwise kept as read, minus one `>` removed from `^>+From `.

use std::io::{self, BufRead};

use chrono::DateTime;

use crate::model::RawMessage;

pub struct MboxReader<R: BufRead> {
    reader: R,
    line: Vec<u8>,
    current: Option<RawMessage>,
    prev_blank: bool,
    done: bool,
}

impl<R: BufRead> MboxReader<R> {
    pub fn new(reader: R) -> Self {
        Self {
            reader,
            line: Vec::new(),
            current: None,
            prev_blank: true,
            done: false,
        }
    }

    /// Drop the blank separator line that ends the message buffer.
    fn finish(&self, mut msg: RawMessage) -> RawMessage {
        if self.prev_blank {
            if msg.bytes.ends_with(b"\r\n") {
                msg.bytes.truncate(msg.bytes.len() - 2);
            } else if msg.bytes.ends_with(b"\n") {
                msg.bytes.truncate(msg.bytes.len() - 1);
            }
        }
        msg
    }
}

fn is_blank(line: &[u8]) -> bool {
    line == b"\n" || line == b"\r\n"
}

/// Parse the date of a `From <id> Sun Nov 01 20:09:16 +0000 2026` line.
fn from_line_date(line: &[u8]) -> Option<i64> {
    let text = std::str::from_utf8(line).ok()?.trim();
    let rest = text.strip_prefix("From ")?.trim_start();
    let (_id, date) = rest.split_once(char::is_whitespace)?;
    DateTime::parse_from_str(date.trim(), "%a %b %d %H:%M:%S %z %Y")
        .ok()
        .map(|d| d.timestamp())
}

impl<R: BufRead> Iterator for MboxReader<R> {
    type Item = io::Result<RawMessage>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.done {
            return None;
        }
        loop {
            self.line.clear();
            match self.reader.read_until(b'\n', &mut self.line) {
                Err(e) => {
                    self.done = true;
                    return Some(Err(e));
                }
                Ok(0) => {
                    self.done = true;
                    let msg = self.current.take()?;
                    return Some(Ok(self.finish(msg)));
                }
                Ok(_) => {}
            }

            let boundary = self.prev_blank && self.line.starts_with(b"From ");
            let finished = if boundary {
                let next = RawMessage {
                    bytes: Vec::new(),
                    from_line_date: from_line_date(&self.line),
                };
                self.current.replace(next).map(|m| self.finish(m))
            } else {
                if let Some(msg) = self.current.as_mut() {
                    let gt = self.line.iter().take_while(|&&b| b == b'>').count();
                    let skip = usize::from(gt > 0 && self.line[gt..].starts_with(b"From "));
                    msg.bytes.extend_from_slice(&self.line[skip..]);
                }
                None
            };
            self.prev_blank = is_blank(&self.line);
            if let Some(msg) = finished {
                return Some(Ok(msg));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::{MsgBuilder, mbox_of};

    fn read_all(mbox: &[u8]) -> Vec<RawMessage> {
        MboxReader::new(mbox)
            .collect::<io::Result<Vec<_>>>()
            .unwrap()
    }

    fn three() -> Vec<Vec<u8>> {
        (1..=3)
            .map(|i| {
                MsgBuilder::new()
                    .subject(&format!("msg {i}"))
                    .text(&format!("body {i}\n\nsecond paragraph"))
                    .build()
            })
            .collect()
    }

    #[test]
    fn splits_three_messages() {
        let msgs = three();
        let got = read_all(&mbox_of(&msgs));
        assert_eq!(got.len(), 3);
        for (g, m) in got.iter().zip(&msgs) {
            assert_eq!(&g.bytes, m);
        }
    }

    #[test]
    fn unescapes_mboxrd() {
        let msg = MsgBuilder::new()
            .text("hello\nFrom here\n>From there\n>>From deeper\nFrom\n")
            .build();
        let mbox = mbox_of(std::slice::from_ref(&msg));
        let s = String::from_utf8_lossy(&mbox);
        assert!(s.contains("\n>From here\n"));
        assert!(s.contains("\n>>From there\n"));
        let got = read_all(&mbox);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].bytes, msg);
    }

    #[test]
    fn parses_from_line_date() {
        let got = read_all(&mbox_of(&three()));
        assert_eq!(got[0].from_line_date, Some(1793563756));
    }

    #[test]
    fn truncated_last_message_is_yielded() {
        let msgs = three();
        let mbox = mbox_of(&msgs);
        let cut = &mbox[..mbox.len() - 20];
        let got = read_all(cut);
        assert_eq!(got.len(), 3);
        assert_eq!(got[1].bytes, msgs[1]);
        assert!(got[2].bytes.len() < msgs[2].len());
        assert!(msgs[2].starts_with(&got[2].bytes));
    }

    #[test]
    fn crlf_input_supported() {
        let msgs = three();
        let crlf = String::from_utf8(mbox_of(&msgs))
            .unwrap()
            .replace('\n', "\r\n");
        let got = read_all(crlf.as_bytes());
        assert_eq!(got.len(), 3);
        assert_eq!(got[0].from_line_date, Some(1793563756));
        for (g, m) in got.iter().zip(&msgs) {
            let expect = String::from_utf8(m.clone()).unwrap().replace('\n', "\r\n");
            assert_eq!(g.bytes, expect.as_bytes());
        }
    }
}
