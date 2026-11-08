//! Open a Takeout zip (or bare mbox) as a streaming reader, without extracting.

use std::fs::File;
use std::io::{self, BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use flate2::read::DeflateDecoder;
use zip::CompressionMethod;
use zip::ZipArchive;

use crate::model::ImportKind;
use crate::{Error, Result};

const FULL_NAME: &str = "All mail Including Spam and Trash.mbox";

pub struct Source {
    pub kind: ImportKind,
    pub label: String,
    pub reader: Box<dyn BufRead + Send>,
    /// Size of the file the reader streams from (zip or mbox), for progress.
    pub total_bytes: Option<u64>,
    /// Bytes consumed so far from that file (compressed bytes for a zip).
    pub bytes_read: Arc<AtomicU64>,
}

/// Verifies the uncompressed size and CRC-32 at EOF (the zip crate's own
/// check is bypassed because the entry is streamed manually).
struct Checking<R> {
    inner: R,
    hasher: crc32fast::Hasher,
    len: u64,
    want_crc: u32,
    want_len: u64,
    verified: bool,
}

impl<R: Read> Read for Checking<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read(buf)?;
        if n > 0 {
            self.hasher.update(&buf[..n]);
            self.len += n as u64;
        } else if !buf.is_empty() && !self.verified {
            self.verified = true;
            if self.len != self.want_len || self.hasher.clone().finalize() != self.want_crc {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "zip entry is corrupt (CRC-32 or size mismatch)",
                ));
            }
        }
        Ok(n)
    }
}

/// Counts bytes read from the underlying file.
struct Counting<R> {
    inner: R,
    count: Arc<AtomicU64>,
}

impl<R: Read> Read for Counting<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.count.fetch_add(n as u64, Ordering::Relaxed);
        Ok(n)
    }
}

fn kind_of(file_name: &str) -> ImportKind {
    if file_name == FULL_NAME {
        ImportKind::Full
    } else {
        ImportKind::Partial
    }
}

fn last_component(name: &str) -> &str {
    name.rsplit(['/', '\\']).next().unwrap_or(name)
}

fn is_mbox(name: &str) -> bool {
    name.to_ascii_lowercase().ends_with(".mbox")
}

struct ZipHit {
    path: PathBuf,
    index: usize,
    entry_name: String,
}

pub fn open_source(paths: &[PathBuf]) -> Result<Source> {
    if paths.is_empty() {
        return Err(Error::Source("no import source given".into()));
    }
    let mut hits: Vec<ZipHit> = Vec::new();
    let mut bare: Vec<&PathBuf> = Vec::new();
    for path in paths {
        if path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("mbox"))
        {
            bare.push(path);
            continue;
        }
        let mut archive = ZipArchive::new(File::open(path)?)
            .map_err(|e| Error::Source(format!("{}: {e}", path.display())))?;
        for index in 0..archive.len() {
            let entry = archive
                .by_index_raw(index)
                .map_err(|e| Error::Source(format!("{}: {e}", path.display())))?;
            if entry.is_dir() {
                continue;
            }
            let name = entry
                .name()
                .map_err(|e| Error::Source(format!("{}: {e}", path.display())))?;
            if is_mbox(&name) {
                hits.push(ZipHit {
                    path: path.clone(),
                    index,
                    entry_name: name.into_owned(),
                });
            }
        }
    }
    if hits.len() + bare.len() > 1 {
        return Err(Error::Source(
            "more than one .mbox found in the import files".into(),
        ));
    }
    if let Some(path) = bare.first() {
        return open_bare(path);
    }
    let hit = hits
        .pop()
        .ok_or_else(|| Error::Source("no .mbox file found in the import files".into()))?;
    open_zip_entry(hit)
}

fn open_bare(path: &Path) -> Result<Source> {
    let file = File::open(path)?;
    let total = file.metadata()?.len();
    let count = Arc::new(AtomicU64::new(0));
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(Source {
        kind: kind_of(&name),
        label: name,
        reader: Box::new(BufReader::with_capacity(
            1 << 20,
            Counting {
                inner: file,
                count: count.clone(),
            },
        )),
        total_bytes: Some(total),
        bytes_read: count,
    })
}

fn open_zip_entry(hit: ZipHit) -> Result<Source> {
    let err = |e: &dyn std::fmt::Display| Error::Source(format!("{}: {e}", hit.path.display()));
    let mut archive = ZipArchive::new(File::open(&hit.path)?).map_err(|e| err(&e))?;
    let (start, size, method, crc, uncompressed) = {
        let entry = archive.by_index_raw(hit.index).map_err(|e| err(&e))?;
        let start = entry
            .data_start()
            .ok_or_else(|| err(&"missing data offset"))?;
        (
            start,
            entry.compressed_size(),
            entry.compression(),
            entry.crc32(),
            entry.size(),
        )
    };
    if archive
        .by_index_raw(hit.index)
        .map_err(|e| err(&e))?
        .encrypted()
    {
        return Err(err(&"encrypted zip entries are not supported"));
    }
    let total = std::fs::metadata(&hit.path)?.len();
    let mut file = archive.into_inner();
    file.seek(SeekFrom::Start(start))?;
    let count = Arc::new(AtomicU64::new(0));
    let raw = Counting {
        inner: BufReader::with_capacity(1 << 20, file).take(size),
        count: count.clone(),
    };
    fn checked<R: Read>(inner: R, crc: u32, len: u64) -> Checking<R> {
        Checking {
            inner,
            hasher: crc32fast::Hasher::new(),
            len: 0,
            want_crc: crc,
            want_len: len,
            verified: false,
        }
    }
    let reader: Box<dyn BufRead + Send> = match method {
        CompressionMethod::Stored => Box::new(BufReader::with_capacity(
            1 << 20,
            checked(raw, crc, uncompressed),
        )),
        CompressionMethod::Deflated => Box::new(BufReader::with_capacity(
            1 << 20,
            checked(DeflateDecoder::new(raw), crc, uncompressed),
        )),
        other => return Err(err(&format!("unsupported compression {other:?}"))),
    };
    let file_name = last_component(&hit.entry_name).to_string();
    Ok(Source {
        kind: kind_of(&file_name),
        label: file_name,
        reader,
        total_bytes: Some(total),
        bytes_read: count,
    })
}
