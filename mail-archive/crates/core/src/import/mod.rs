//! Importing a Gmail Takeout: open the source, then scan (diff) it against the library.

use std::io::BufRead;

use crate::Result;
use crate::mbox::MboxReader;
use crate::model::RawMessage;

pub mod apply;
pub mod scan;
pub mod source;

/// Most messages read and parsed together.
pub(crate) const BATCH_MESSAGES: usize = 2_000;
/// Most raw bytes held in one batch (a batch always holds at least one message).
pub(crate) const BATCH_BYTES: usize = 64 << 20;

/// Refill `batch` with up to `max_messages` messages or about [`BATCH_BYTES`]
/// of raw bytes, whichever comes first. Returns `true` once the source is
/// exhausted.
pub(crate) fn fill_batch<R: BufRead>(
    mbox: &mut MboxReader<R>,
    batch: &mut Vec<RawMessage>,
    max_messages: usize,
) -> Result<bool> {
    batch.clear();
    let mut bytes = 0usize;
    while batch.len() < max_messages && bytes < BATCH_BYTES {
        match mbox.next() {
            Some(m) => {
                let m = m?;
                bytes += m.bytes.len();
                batch.push(m);
            }
            None => return Ok(true),
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::mbox_of;

    #[test]
    fn batches_cap_messages_and_bytes() {
        let small = vec![b"Subject: a\n\nhi\n".to_vec(); 5];
        let mbox = mbox_of(&small);
        let mut r = MboxReader::new(&mbox[..]);
        let mut b = Vec::new();
        assert!(!fill_batch(&mut r, &mut b, 2).unwrap());
        assert_eq!(b.len(), 2);
        assert!(!fill_batch(&mut r, &mut b, 2).unwrap());
        assert!(fill_batch(&mut r, &mut b, 2).unwrap());
        assert_eq!(b.len(), 1);

        let big = vec![vec![b'x'; BATCH_BYTES / 2 + 1]; 3];
        let mut msgs: Vec<Vec<u8>> = big
            .into_iter()
            .map(|mut body| {
                let mut m = b"Subject: big\n\n".to_vec();
                m.append(&mut body);
                m.push(b'\n');
                m
            })
            .collect();
        msgs.push(b"Subject: tail\n\nx\n".to_vec());
        let mbox = mbox_of(&msgs);
        let mut r = MboxReader::new(&mbox[..]);
        assert!(!fill_batch(&mut r, &mut b, 2_000).unwrap());
        assert_eq!(b.len(), 2, "stops once the byte cap is reached");
        assert!(fill_batch(&mut r, &mut b, 2_000).unwrap());
        assert_eq!(b.len(), 2);
    }
}
