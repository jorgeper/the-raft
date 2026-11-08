//! Tauri commands, shared app state, and the helpers behind them.
//!
//! Error strings returned to the UI are fixed text per error kind. They never
//! include message content (or paths, or underlying library messages).

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, TryLockError};

use mail_core::Error;
use mail_core::import::scan::{Progress, ScanReport};
use mail_core::library::{Library, SearchResults, SuggestKind};
use mail_core::meta::MessageRow;
use mail_core::model::{Address, AttachmentInfo};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::config::Config;
use crate::protocol::{RenderCache, body_url, render_cached};

const NOT_OPEN: &str = "library not open";
const BUSY: &str = "library is busy";

pub struct Inner {
    lib: Mutex<Option<Library>>,
    /// Why the configured library could not be opened at startup (fixed text).
    open_error: Mutex<Option<String>>,
    /// Outside the library mutex so `import_cancel` never waits on the lock.
    cancel: Arc<AtomicBool>,
    pending: Mutex<Option<ScanReport>>,
    cache: RenderCache,
    config_path: PathBuf,
    session_dir: PathBuf,
}

#[derive(Clone)]
pub struct AppState(Arc<Inner>);

/// Why a library fetch for the protocol handlers failed.
#[derive(Debug, PartialEq, Eq)]
pub enum Fetch {
    /// The library lock is held by a long operation; do not queue behind it.
    Busy,
    NotFound,
    Failed,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Fixed, content-free text for each error kind.
pub fn err_text(e: &Error) -> String {
    match e {
        Error::LibraryInUse => "the library is in use by another process",
        Error::Cancelled => "cancelled",
        Error::SourceChanged => "the import source changed since it was scanned; scan it again",
        Error::StaleScan => "the library changed since it was scanned; scan again",
        Error::NeedsRebuild => "the library needs a rebuild first",
        Error::Io(_) => "file error",
        Error::Source(_) => "could not read the import source",
        Error::Parse(_) => "a message could not be parsed",
        Error::RollbackFailed { .. } => {
            "import failed and could not be rolled back; reopen the library"
        }
        _ => "library error",
    }
    .to_string()
}

/// Text for `LibraryStatus.open_error`.
fn open_error_text(e: &Error) -> String {
    match e {
        Error::LibraryInUse => "Library is in use by another process (mail-cli?).",
        _ => "Library could not be opened.",
    }
    .to_string()
}

/// Open the library at startup, keeping the reason on failure.
pub fn open_library(path: &Path) -> (Option<Library>, Option<String>) {
    match Library::open(path) {
        Ok(l) => (Some(l), None),
        Err(e) => {
            eprintln!("mail-archive: could not open library: {}", err_text(&e));
            (None, Some(open_error_text(&e)))
        }
    }
}

fn fetch_error(e: &Error) -> Fetch {
    // `Meta` is what the metadata layer returns for an unknown id.
    match e {
        Error::Meta(_) => Fetch::NotFound,
        other => {
            eprintln!("mail-archive: library read failed: {}", err_text(other));
            Fetch::Failed
        }
    }
}

impl AppState {
    pub fn new(
        lib: Option<Library>,
        open_error: Option<String>,
        config_path: PathBuf,
        session_dir: PathBuf,
    ) -> AppState {
        AppState(Arc::new(Inner {
            lib: Mutex::new(lib),
            open_error: Mutex::new(open_error),
            cancel: Arc::new(AtomicBool::new(false)),
            pending: Mutex::new(None),
            cache: RenderCache::default(),
            config_path,
            session_dir,
        }))
    }

    pub fn cache(&self) -> &RenderCache {
        &self.0.cache
    }

    pub fn session_dir(&self) -> &Path {
        &self.0.session_dir
    }

    /// Lock the library: waiting (`wait`) or failing fast with `Busy`.
    fn lib_guard(&self, wait: bool) -> Result<MutexGuard<'_, Option<Library>>, Fetch> {
        if wait {
            return Ok(lock(&self.0.lib));
        }
        match self.0.lib.try_lock() {
            Ok(g) => Ok(g),
            Err(TryLockError::Poisoned(p)) => Ok(p.into_inner()),
            Err(TryLockError::WouldBlock) => Err(Fetch::Busy),
        }
    }

    /// Raw bytes of a message; the library lock is released before returning.
    pub fn raw(&self, id: i64, wait: bool) -> Result<Vec<u8>, Fetch> {
        let g = self.lib_guard(wait)?;
        let lib = g.as_ref().ok_or(Fetch::NotFound)?;
        lib.raw(id).map_err(|e| fetch_error(&e))
    }

    pub fn message_and_raw(&self, id: i64, wait: bool) -> Result<(MessageRow, Vec<u8>), Fetch> {
        let g = self.lib_guard(wait)?;
        let lib = g.as_ref().ok_or(Fetch::NotFound)?;
        let row = lib.message(id).map_err(|e| fetch_error(&e))?;
        let raw = lib.raw(id).map_err(|e| fetch_error(&e))?;
        Ok((row, raw))
    }

    fn with_lib<T>(&self, f: impl FnOnce(&Library) -> Result<T, Error>) -> Result<T, String> {
        let g = lock(&self.0.lib);
        let lib = g.as_ref().ok_or_else(|| NOT_OPEN.to_string())?;
        f(lib).map_err(|e| err_text(&e))
    }

    fn with_lib_mut<T>(
        &self,
        f: impl FnOnce(&mut Library) -> Result<T, Error>,
    ) -> Result<T, String> {
        let mut g = lock(&self.0.lib);
        let lib = g.as_mut().ok_or_else(|| NOT_OPEN.to_string())?;
        f(lib).map_err(|e| err_text(&e))
    }

    pub fn scan(
        &self,
        paths: &[PathBuf],
        progress: &dyn Fn(Progress),
    ) -> Result<serde_json::Value, String> {
        *lock(&self.0.pending) = None;
        let report = self.with_lib(|l| {
            // Reset only once we hold the lock, so a queued operation cannot
            // clear a cancel aimed at the running one.
            self.0.cancel.store(false, Ordering::SeqCst);
            mail_core::import::scan::scan(l, paths, progress, &self.0.cancel)
        })?;
        let json = serde_json::to_value(&report).map_err(|_| "internal error".to_string())?;
        *lock(&self.0.pending) = Some(report);
        Ok(json)
    }

    pub fn apply_pending(
        &self,
        progress: &dyn Fn(Progress),
    ) -> Result<mail_core::import::apply::ImportSummary, String> {
        let report = lock(&self.0.pending)
            .take()
            .ok_or_else(|| "no scan is pending; scan first".to_string())?;
        self.with_lib_mut(|l| {
            self.0.cancel.store(false, Ordering::SeqCst);
            mail_core::import::apply::apply(l, &report, progress, &self.0.cancel)
        })
    }

    pub fn rebuild(&self, progress: &dyn Fn(Progress)) -> Result<(), String> {
        let r = self.with_lib_mut(|l| {
            self.0.cancel.store(false, Ordering::SeqCst);
            l.rebuild(progress, &self.0.cancel).map(|_| ())
        });
        self.0.cache.clear();
        r
    }

    /// Never waits behind an import or rebuild: `Err` when the library is busy.
    pub fn status(&self) -> Result<LibraryStatus, String> {
        let g = self.lib_guard(false).map_err(|_| BUSY.to_string())?;
        let configured_path = Config::load_from(&self.0.config_path).library_path;
        Ok(match g.as_ref() {
            Some(l) => {
                let (message_count, open_error) = match l.count() {
                    Ok(n) => (n, None),
                    Err(e) => {
                        eprintln!("mail-archive: count failed: {}", err_text(&e));
                        (0, Some("Library could not be read.".to_string()))
                    }
                };
                LibraryStatus {
                    path: l.dir().display().to_string(),
                    configured: true,
                    message_count,
                    needs_rebuild: l.needs_rebuild(),
                    open_error,
                }
            }
            None => LibraryStatus {
                configured: configured_path.is_some(),
                path: configured_path
                    .unwrap_or_else(mail_core::paths::default_library_dir)
                    .display()
                    .to_string(),
                message_count: 0,
                needs_rebuild: false,
                open_error: lock(&self.0.open_error).clone(),
            },
        })
    }

    pub fn set_library(&self, path: &str) -> Result<Option<String>, String> {
        let dir = PathBuf::from(path);
        if !dir.is_absolute() {
            return Err("the library path must be absolute".to_string());
        }
        let warning = mail_core::paths::cloud_sync_warning(&dir).map(str::to_string);
        {
            let mut g = lock(&self.0.lib);
            if g.as_ref().is_none_or(|l| l.dir() != dir) {
                // Release the old library (and its lock) only once the new one opened.
                let new = Library::open(&dir).map_err(|e| err_text(&e))?;
                *g = Some(new);
            }
            // Clear (bumping the generation) while still holding the library
            // lock, so the swap and the clear happen together.
            self.0.cache.clear();
        }
        *lock(&self.0.open_error) = None;
        *lock(&self.0.pending) = None;
        Config {
            library_path: Some(dir),
        }
        .save_to(&self.0.config_path)
        .map_err(|_| "could not save settings".to_string())?;
        Ok(warning)
    }
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|_| "internal error".to_string())?
}

#[derive(Serialize)]
pub struct MessageView {
    pub id: i64,
    pub from: Option<Address>,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    pub date: i64,
    pub labels: Vec<String>,
    pub subject: String,
    pub attachments: Vec<AttachmentInfo>,
    /// `mailbody://localhost/{id}?t=<term>&t=<term>...`
    pub body_url: String,
    pub blocked_remote: u32,
}

#[derive(Serialize, Debug)]
pub struct LibraryStatus {
    pub path: String,
    /// True when a library path is configured, even if it failed to open.
    pub configured: bool,
    pub message_count: u64,
    pub needs_rebuild: bool,
    /// Fixed text when the configured library could not be opened or read.
    pub open_error: Option<String>,
}

#[tauri::command]
pub async fn search(
    state: State<'_, AppState>,
    q: String,
    offset: u32,
    limit: u32,
) -> Result<SearchResults, String> {
    let st = state.inner().clone();
    blocking(move || {
        let now = chrono::Utc::now().timestamp();
        st.with_lib(|l| l.search(&q, offset as usize, limit as usize, now, &chrono::Local))
    })
    .await
}

#[tauri::command]
pub async fn get_thread(
    state: State<'_, AppState>,
    thrid: i64,
    terms: Vec<String>,
) -> Result<Vec<MessageView>, String> {
    let st = state.inner().clone();
    blocking(move || {
        // Read the generation before fetching raw bytes: a library swap in
        // between makes our cache inserts stale, and `put` drops them.
        let generation = st.cache().generation();
        // Collect rows and raw bytes under the lock, then render without it.
        let rows: Vec<(MessageRow, Vec<u8>)> = st.with_lib(|l| {
            l.thread(thrid)?
                .into_iter()
                .map(|r| l.raw(r.id).map(|raw| (r, raw)))
                .collect()
        })?;
        Ok(rows
            .into_iter()
            .map(|(r, raw)| {
                let body = render_cached(&st, r.id, &raw, &terms, generation);
                MessageView {
                    id: r.id,
                    from: r.from,
                    to: r.to,
                    cc: r.cc,
                    date: r.date,
                    labels: r.labels,
                    subject: r.subject,
                    attachments: r.attachments,
                    body_url: body_url(r.id, &terms),
                    blocked_remote: body.blocked_remote,
                }
            })
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn autocomplete(
    state: State<'_, AppState>,
    kind: String,
    prefix: String,
) -> Result<Vec<String>, String> {
    let kind = match kind.as_str() {
        "label" => SuggestKind::Label,
        "address" => SuggestKind::Address,
        _ => return Err("unknown suggestion kind".into()),
    };
    let st = state.inner().clone();
    blocking(move || st.with_lib(|l| l.autocomplete(kind, &prefix))).await
}

fn attachment_part(
    st: &AppState,
    msg_id: i64,
    part: u32,
) -> Result<(AttachmentInfo, Vec<u8>), String> {
    let (row, raw) = st.message_and_raw(msg_id, true).map_err(|f| match f {
        Fetch::NotFound => "message not found".to_string(),
        _ => "library error".to_string(),
    })?;
    let info = row
        .attachments
        .into_iter()
        .find(|a| a.part_index == part)
        .ok_or_else(|| "attachment not found".to_string())?;
    let bytes = mail_core::parse::attachment_bytes(&raw, part)
        .ok_or_else(|| "attachment could not be read".to_string())?;
    Ok((info, bytes))
}

/// Unicode general category Cf (format) code points, plus U+2028/2029
/// (line/paragraph separators): bidi overrides, zero-width characters and the
/// like, which can disguise a file name. Source: the Cf listing of
/// DerivedGeneralCategory.txt, Unicode 16.0 (identical to 15.1 for Cf).
fn is_invisible_format(c: char) -> bool {
    matches!(c as u32,
        0x00AD | 0x0600..=0x0605 | 0x061C | 0x06DD | 0x070F | 0x0890..=0x0891 | 0x08E2
        | 0x180E | 0x200B..=0x200F | 0x2028..=0x202E | 0x2060..=0x2064 | 0x2066..=0x206F
        | 0xFEFF | 0xFFF9..=0xFFFB | 0x110BD | 0x110CD | 0x13430..=0x1343F
        | 0x1BCA0..=0x1BCA3 | 0x1D173..=0x1D17A | 0xE0001 | 0xE0020..=0xE007F)
}

const MAX_NAME_CHARS: usize = 120;
const MAX_EXT_CHARS: usize = 20;

/// A safe single path component: no separators, no leading dot, no control or
/// format characters, bounded length (the extension survives truncation).
pub fn sanitize_filename(name: Option<&str>) -> String {
    let cleaned: String = name
        .unwrap_or("")
        .chars()
        .filter(|c| !c.is_control() && !is_invisible_format(*c))
        .map(|c| {
            if c == '/' || c == '\\' || c == ':' {
                '_'
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.').trim();
    if cleaned.is_empty() {
        return "attachment".to_string();
    }
    let len = cleaned.chars().count();
    if len <= MAX_NAME_CHARS {
        return cleaned.to_string();
    }
    match cleaned.rfind('.') {
        Some(dot) => {
            let (stem, ext) = cleaned.split_at(dot);
            let ext_len = ext.chars().count();
            if stem.is_empty() || ext_len > MAX_EXT_CHARS {
                cleaned.chars().take(MAX_NAME_CHARS).collect()
            } else {
                let keep = MAX_NAME_CHARS - ext_len;
                format!("{}{ext}", stem.chars().take(keep).collect::<String>())
            }
        }
        None => cleaned.chars().take(MAX_NAME_CHARS).collect(),
    }
}

/// Mark a file as downloaded from outside so Gatekeeper/LaunchServices warn
/// before opening it, as they do for Mail.app attachments.
#[cfg(target_os = "macos")]
fn set_quarantine(path: &Path) -> std::io::Result<()> {
    use std::os::unix::ffi::OsStrExt;
    let c_path = std::ffi::CString::new(path.as_os_str().as_bytes())
        .map_err(|_| std::io::Error::other("bad path"))?;
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let value = format!("0081;{secs:x};Mail Archive;");
    // SAFETY: both strings are valid for the duration of the call and `value`
    // is passed with its exact length.
    let rc = unsafe {
        libc::setxattr(
            c_path.as_ptr(),
            c"com.apple.quarantine".as_ptr(),
            value.as_ptr().cast(),
            value.len(),
            0,
            0,
        )
    };
    if rc == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(not(target_os = "macos"))]
fn set_quarantine(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

/// Write a private (0600), quarantined copy of an attachment into `dir`.
/// Any existing file is replaced, so reopening yields exactly `bytes`.
pub fn write_temp_copy(dir: &Path, name: &str, bytes: &[u8]) -> std::io::Result<PathBuf> {
    use std::os::unix::fs::OpenOptionsExt;
    mail_core::paths::create_private_dir(dir)?;
    let file = dir.join(name);
    match std::fs::remove_file(&file) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&file)?;
    f.write_all(bytes)?;
    drop(f);
    set_quarantine(&file)?;
    Ok(file)
}

/// Name of the temp file used to save `dest` atomically.
fn atomic_tmp_path(dest: &Path, nonce: u128) -> std::io::Result<PathBuf> {
    let name = dest
        .file_name()
        .ok_or_else(|| std::io::Error::other("no file name"))?;
    Ok(dest.with_file_name(format!(
        ".{}.{}.{nonce:x}.tmp",
        name.to_string_lossy(),
        std::process::id()
    )))
}

/// Write `bytes` to a new private temp file beside `dest`, then rename over
/// it. The temp file is created exclusively (O_EXCL), so a file or symlink
/// planted at that name makes this fail instead of being followed.
pub fn write_atomic(dest: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    write_atomic_with_nonce(dest, bytes, nonce)
}

fn write_atomic_with_nonce(dest: &Path, bytes: &[u8], nonce: u128) -> std::io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    let tmp = atomic_tmp_path(dest, nonce)?;
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&tmp)?;
    // Only a file we created is ours to clean up.
    let result = f
        .write_all(bytes)
        .and_then(|()| f.sync_all())
        .and_then(|()| std::fs::rename(&tmp, dest));
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

/// Remove `session-*` directories left by earlier runs (not `keep`).
pub fn sweep_stale_sessions(base: &Path, keep: &str) {
    let Ok(entries) = std::fs::read_dir(base) else {
        return;
    };
    for e in entries.flatten() {
        let name = e.file_name();
        let name = name.to_string_lossy();
        if name.starts_with("session-") && name != keep {
            let _ = std::fs::remove_dir_all(e.path());
        }
    }
}

#[tauri::command]
pub async fn open_attachment(
    state: State<'_, AppState>,
    msg_id: i64,
    part: u32,
) -> Result<(), String> {
    let st = state.inner().clone();
    blocking(move || {
        let (info, bytes) = attachment_part(&st, msg_id, part)?;
        let dir = st.session_dir().join(format!("{msg_id}-{part}"));
        let file = write_temp_copy(&dir, &sanitize_filename(info.filename.as_deref()), &bytes)
            .map_err(|_| "file error".to_string())?;
        run_open(&file)
    })
    .await
}

/// `/usr/bin/open <target>` with the target as one argument, never via a shell.
/// `open` returns once LaunchServices has the request; waiting reaps it.
pub fn run_open(target: impl AsRef<std::ffi::OsStr>) -> Result<(), String> {
    match Command::new("/usr/bin/open").arg(target).status() {
        Ok(s) if s.success() => Ok(()),
        _ => Err("could not open".to_string()),
    }
}

#[tauri::command]
pub async fn save_attachment(
    state: State<'_, AppState>,
    msg_id: i64,
    part: u32,
    dest: String,
) -> Result<(), String> {
    let st = state.inner().clone();
    blocking(move || {
        let dest = PathBuf::from(dest);
        if !dest.is_absolute() {
            return Err("the destination must be an absolute path".to_string());
        }
        let (_, bytes) = attachment_part(&st, msg_id, part)?;
        write_atomic(&dest, &bytes).map_err(|_| "could not save the file".to_string())
    })
    .await
}

/// Only http, https and mailto links may leave the app.
pub fn validate_link(url: &str) -> Result<(), String> {
    let bad = || Err("unsupported link".to_string());
    if url.is_empty() || url.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return bad();
    }
    let Some((scheme, rest)) = url.split_once(':') else {
        return bad();
    };
    match scheme.to_ascii_lowercase().as_str() {
        "http" | "https" if rest.starts_with("//") && rest.len() > 2 => Ok(()),
        "mailto" if !rest.is_empty() => Ok(()),
        _ => bad(),
    }
}

#[tauri::command]
pub async fn open_link(url: String) -> Result<(), String> {
    validate_link(&url)?;
    blocking(move || run_open(&url)).await
}

fn emit_progress(app: &AppHandle) -> impl Fn(Progress) + use<> {
    let app = app.clone();
    move |p| {
        let _ = app.emit("progress", p);
    }
}

#[tauri::command]
pub async fn import_scan(
    app: AppHandle,
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<serde_json::Value, String> {
    let st = state.inner().clone();
    let progress = emit_progress(&app);
    blocking(move || {
        let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
        st.scan(&paths, &progress)
    })
    .await
}

#[tauri::command]
pub async fn import_apply(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<mail_core::import::apply::ImportSummary, String> {
    let st = state.inner().clone();
    let progress = emit_progress(&app);
    blocking(move || st.apply_pending(&progress)).await
}

/// Only sets a flag: never takes a lock, so it cannot wait on an import.
#[tauri::command]
pub fn import_cancel(state: State<'_, AppState>) {
    state.0.cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub async fn rebuild_index(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let st = state.inner().clone();
    let progress = emit_progress(&app);
    blocking(move || st.rebuild(&progress)).await
}

#[tauri::command]
pub async fn library_status(state: State<'_, AppState>) -> Result<LibraryStatus, String> {
    let st = state.inner().clone();
    blocking(move || st.status()).await
}

#[tauri::command]
pub async fn set_library_path(
    state: State<'_, AppState>,
    path: String,
) -> Result<Option<String>, String> {
    let st = state.inner().clone();
    blocking(move || st.set_library(&path)).await
}

/// Test helpers shared with protocol tests.
#[cfg(test)]
pub mod test_support {
    use super::*;
    use mail_core::testing::mbox_of;

    /// An AppState over a real library imported from raw RFC 822 messages.
    /// Message ids are assigned 1..=n in order.
    pub fn state_with(msgs: &[Vec<u8>]) -> (AppState, Vec<i64>, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let mbox = dir.path().join("in.mbox");
        std::fs::write(&mbox, mbox_of(msgs)).unwrap();
        let mut lib = Library::open(&dir.path().join("lib")).unwrap();
        lib.import(&[mbox], &|_| {}, &AtomicBool::new(false))
            .unwrap();
        let ids: Vec<i64> = (1..=msgs.len() as i64).collect();
        for id in &ids {
            assert!(lib.message(*id).is_ok());
        }
        let st = AppState::new(
            Some(lib),
            None,
            dir.path().join("config.json"),
            dir.path().join("session"),
        );
        (st, ids, dir)
    }

    /// Hold the library lock, to simulate a running import.
    pub fn hold_lib_lock(st: &AppState) -> MutexGuard<'_, Option<Library>> {
        lock(&st.0.lib)
    }

    pub fn unconfigured(dir: &Path) -> AppState {
        AppState::new(None, None, dir.join("config.json"), dir.join("session"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mail_core::testing::MsgBuilder;

    fn one_msg() -> Vec<u8> {
        MsgBuilder::new()
            .from("a@example.com")
            .subject("Att")
            .thrid(1)
            .date_rfc2822("Mon, 01 Jun 2020 10:00:00 +0000")
            .message_id(Some("<a@x>"))
            .text("hi")
            .attach("doc.txt", "text/plain", b"hello")
            .build()
    }

    #[test]
    fn open_link_rejects_other_schemes() {
        for bad in [
            "file:///etc/passwd",
            "javascript:x",
            "data:text/html,hi",
            "ftp://example.com",
            "-a Calculator",
            " http://example.com",
            "http://exa mple.com",
            "http:",
            "https://",
            "",
            "example.com",
        ] {
            assert!(validate_link(bad).is_err(), "{bad:?}");
        }
        for good in [
            "http://example.com/a?b=c",
            "HTTPS://example.com",
            "mailto:a@example.com",
        ] {
            assert!(validate_link(good).is_ok(), "{good:?}");
        }
    }

    #[test]
    fn filenames_are_sanitized() {
        assert_eq!(
            sanitize_filename(Some("../../etc/passwd")),
            "_.._etc_passwd"
        );
        assert_eq!(sanitize_filename(Some(".hidden")), "hidden");
        assert_eq!(sanitize_filename(Some("a/b\\c.txt")), "a_b_c.txt");
        assert_eq!(sanitize_filename(Some("...")), "attachment");
        assert_eq!(sanitize_filename(None), "attachment");
        assert_eq!(sanitize_filename(Some("a\u{0}b\nc")), "abc");
    }

    #[test]
    fn filenames_lose_format_characters() {
        // Right-to-left override disguising "exe.txt", zero-width space/joiner, BOM.
        assert_eq!(
            sanitize_filename(Some("report\u{202E}txt.exe")),
            "reporttxt.exe"
        );
        assert_eq!(
            sanitize_filename(Some("a\u{200B}b\u{200D}c\u{FEFF}")),
            "abc"
        );
        assert_eq!(sanitize_filename(Some("\u{2066}\u{2069}")), "attachment");
        // Arabic number mark above (Cf, added in Unicode 14).
        assert_eq!(sanitize_filename(Some("a\u{0890}b\u{0891}c")), "abc");
    }

    #[test]
    fn long_filenames_keep_their_extension() {
        let n = sanitize_filename(Some(&format!("{}.pdf", "x".repeat(500))));
        assert_eq!(n.chars().count(), 120);
        assert!(n.ends_with(".pdf"), "{n}");
        let n = sanitize_filename(Some(&"y".repeat(500)));
        assert_eq!(n.chars().count(), 120);
        // A absurdly long "extension" is not preserved.
        let n = sanitize_filename(Some(&format!("a.{}", "z".repeat(500))));
        assert_eq!(n.chars().count(), 120);
        // Multibyte names truncate on character boundaries.
        let n = sanitize_filename(Some(&format!("{}.txt", "é".repeat(300))));
        assert_eq!(n.chars().count(), 120);
        assert!(n.ends_with(".txt"));
    }

    #[test]
    fn errors_have_no_content() {
        let e = Error::Meta("secret subject line".into());
        assert!(!err_text(&e).contains("secret"));
        let e = Error::Source("/Users/x/secret.mbox".into());
        assert!(!err_text(&e).contains("secret"));
    }

    #[test]
    fn attachment_lookup_and_no_pending_scan() {
        let (st, ids, _d) = test_support::state_with(&[one_msg()]);
        let row = st.message_and_raw(ids[0], true).unwrap().0;
        let part = row.attachments[0].part_index;
        let (info, bytes) = attachment_part(&st, ids[0], part).unwrap();
        assert_eq!(info.filename.as_deref(), Some("doc.txt"));
        assert_eq!(bytes, b"hello");
        assert!(attachment_part(&st, ids[0], 99).is_err());
        assert!(attachment_part(&st, 999, 0).is_err());
        // Applying without a scan is an error, and the library is untouched.
        let err = st.apply_pending(&|_| {}).unwrap_err();
        assert!(err.contains("no scan is pending"), "{err}");
    }

    #[test]
    fn scan_then_apply_imports_once() {
        let (st, _ids, d) = test_support::state_with(&[one_msg()]);
        let other = MsgBuilder::new()
            .from("b@example.com")
            .subject("Second")
            .thrid(2)
            .date_rfc2822("Tue, 02 Jun 2020 10:00:00 +0000")
            .message_id(Some("<b@x>"))
            .text("yo")
            .build();
        let mbox = d.path().join("second.mbox");
        std::fs::write(&mbox, mail_core::testing::mbox_of(&[other])).unwrap();
        let report = st.scan(&[mbox], &|_| {}).unwrap();
        assert_eq!(report["new"], 1);
        let summary = st.apply_pending(&|_| {}).unwrap();
        assert_eq!(summary.added, 1);
        assert_eq!(st.status().unwrap().message_count, 2);
        // The pending report was consumed.
        assert!(st.apply_pending(&|_| {}).is_err());
    }

    #[test]
    fn temp_copy_is_private_quarantined_and_replaced() {
        let d = tempfile::tempdir().unwrap();
        let dir = d.path().join("1-0");
        let p = write_temp_copy(&dir, "f.txt", b"first, longer contents").unwrap();
        // Reopening gives exactly the original bytes, not a mix.
        let p2 = write_temp_copy(&dir, "f.txt", b"short").unwrap();
        assert_eq!(p, p2);
        assert_eq!(std::fs::read(&p).unwrap(), b"short");
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&p).unwrap().permissions().mode() & 0o777,
            0o600
        );
        #[cfg(target_os = "macos")]
        {
            use std::os::unix::ffi::OsStrExt;
            let c = std::ffi::CString::new(p.as_os_str().as_bytes()).unwrap();
            let mut buf = [0u8; 128];
            let n = unsafe {
                libc::getxattr(
                    c.as_ptr(),
                    c"com.apple.quarantine".as_ptr(),
                    buf.as_mut_ptr().cast(),
                    buf.len(),
                    0,
                    0,
                )
            };
            assert!(n > 0, "no quarantine xattr");
            let v = std::str::from_utf8(&buf[..n as usize]).unwrap();
            assert!(
                v.starts_with("0081;") && v.ends_with(";Mail Archive;"),
                "{v}"
            );
            let secs = v.split(';').nth(1).unwrap();
            assert!(u64::from_str_radix(secs, 16).unwrap() > 1_600_000_000);
        }
    }

    #[test]
    fn save_is_atomic_and_replaces() {
        let d = tempfile::tempdir().unwrap();
        let dest = d.path().join("out.bin");
        write_atomic(&dest, b"old old old").unwrap();
        write_atomic(&dest, b"new").unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b"new");
        let names: Vec<_> = std::fs::read_dir(d.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names.len(), 1, "temp file left behind: {names:?}");
        assert!(write_atomic(&d.path().join("missing-dir/x"), b"x").is_err());
    }

    #[test]
    fn save_does_not_follow_a_planted_symlink() {
        let d = tempfile::tempdir().unwrap();
        let dest = d.path().join("out.bin");
        let victim = d.path().join("victim");
        std::fs::write(&victim, b"precious").unwrap();
        let tmp = atomic_tmp_path(&dest, 7).unwrap();
        std::os::unix::fs::symlink(&victim, &tmp).unwrap();

        assert!(write_atomic_with_nonce(&dest, b"attacker data", 7).is_err());
        assert_eq!(std::fs::read(&victim).unwrap(), b"precious");
        assert!(!dest.exists());
        // The planted link is left alone, not removed or written through.
        assert!(
            std::fs::symlink_metadata(&tmp)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        // A fresh nonce works, and the result is private.
        write_atomic(&dest, b"ok").unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b"ok");
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&dest).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn stale_sessions_are_swept() {
        let d = tempfile::tempdir().unwrap();
        for n in ["session-1", "session-2", "session-9", "other"] {
            std::fs::create_dir_all(d.path().join(n).join("sub")).unwrap();
        }
        sweep_stale_sessions(d.path(), "session-9");
        assert!(!d.path().join("session-1").exists());
        assert!(!d.path().join("session-2").exists());
        assert!(d.path().join("session-9").exists());
        assert!(d.path().join("other").exists());
        sweep_stale_sessions(&d.path().join("nope"), "x"); // no panic
    }

    #[test]
    fn unconfigured_then_set_library_path() {
        let d = tempfile::tempdir().unwrap();
        let st = test_support::unconfigured(d.path());
        let s = st.status().unwrap();
        assert!(!s.configured && s.open_error.is_none());
        // Library commands fail cleanly while nothing is open.
        assert_eq!(st.with_lib(|l| l.count()).unwrap_err(), "library not open");
        assert!(st.set_library("relative/path").is_err());

        let lib_dir = d.path().join("mylib");
        let warn = st.set_library(lib_dir.to_str().unwrap()).unwrap();
        assert!(warn.is_none());
        let s = st.status().unwrap();
        assert!(s.configured && s.open_error.is_none());
        assert_eq!(s.message_count, 0);
        assert_eq!(s.path, lib_dir.display().to_string());
        assert_eq!(
            Config::load_from(&d.path().join("config.json")).library_path,
            Some(lib_dir)
        );
    }

    #[test]
    fn open_failure_is_reported_not_hidden() {
        let d = tempfile::tempdir().unwrap();
        let lib_dir = d.path().join("lib");
        let _held = Library::open(&lib_dir).unwrap();
        let (lib, err) = open_library(&lib_dir);
        assert!(lib.is_none());
        let err = err.unwrap();
        assert_eq!(err, "Library is in use by another process (mail-cli?).");

        let cfg = d.path().join("config.json");
        Config {
            library_path: Some(lib_dir.clone()),
        }
        .save_to(&cfg)
        .unwrap();
        let st = AppState::new(None, Some(err.clone()), cfg, d.path().join("session"));
        let s = st.status().unwrap();
        assert!(s.configured, "configured stays true when open failed");
        assert_eq!(s.open_error.as_deref(), Some(err.as_str()));
        assert_eq!(s.path, lib_dir.display().to_string());
        assert_eq!(st.with_lib(|l| l.count()).unwrap_err(), "library not open");
        // Pointing at a library that opens clears the error.
        let other = d.path().join("other");
        st.set_library(other.to_str().unwrap()).unwrap();
        assert!(st.status().unwrap().open_error.is_none());

        // A non-library path yields the generic text.
        let bad = d.path().join("file");
        std::fs::write(&bad, b"x").unwrap();
        let (lib, err) = open_library(&bad);
        assert!(lib.is_none());
        assert_eq!(err.unwrap(), "Library could not be opened.");
    }

    #[test]
    fn busy_library_fails_fast() {
        let (st, ids, _d) = test_support::state_with(&[one_msg()]);
        let held = test_support::hold_lib_lock(&st);
        assert_eq!(st.raw(ids[0], false).unwrap_err(), Fetch::Busy);
        assert_eq!(st.message_and_raw(ids[0], false).unwrap_err(), Fetch::Busy);
        assert!(st.status().is_err());
        drop(held);
        assert!(st.raw(ids[0], false).is_ok());
        assert_eq!(st.raw(9999, false).unwrap_err(), Fetch::NotFound);
    }

    #[test]
    fn render_started_before_a_library_swap_is_not_cached() {
        use crate::protocol::render_cached;
        let (st, ids, d) = test_support::state_with(&[one_msg()]);
        // Deterministic interleaving of a handler racing set_library:
        let generation = st.cache().generation();
        let raw = st.raw(ids[0], true).unwrap(); // raw from the OLD library
        st.set_library(d.path().join("other").to_str().unwrap())
            .unwrap(); // swap + clear
        let body = render_cached(&st, ids[0], &raw, &[], generation);
        assert!(!body.html.is_empty());
        // The stale body must not be stored under the new library's id.
        assert!(st.cache().get(ids[0], &[]).is_none());
        // A render that captured the generation after the swap is cached.
        let g2 = st.cache().generation();
        render_cached(&st, ids[0], &raw, &[], g2);
        assert!(st.cache().get(ids[0], &[]).is_some());
    }

    #[test]
    fn cancel_flag_is_reset_only_under_the_lock() {
        let (st, _ids, _d) = test_support::state_with(&[one_msg()]);
        let held = test_support::hold_lib_lock(&st);
        st.0.cancel.store(true, Ordering::SeqCst);
        let st2 = st.clone();
        let t = std::thread::spawn(move || {
            let _ = st2.rebuild(&|_| {});
        });
        std::thread::sleep(std::time::Duration::from_millis(150));
        // The queued rebuild has not touched the flag while the lock is held.
        assert!(st.0.cancel.load(Ordering::SeqCst));
        drop(held);
        t.join().unwrap();
    }
}
