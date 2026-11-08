//! Tauri commands, shared app state, and the helpers behind them.
//!
//! Error strings returned to the UI are fixed text per error kind. They never
//! include message content (or paths, or underlying library messages).

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use mail_core::Error;
use mail_core::import::scan::{Progress, ScanReport};
use mail_core::library::{Library, SearchResults, SuggestKind};
use mail_core::meta::MessageRow;
use mail_core::model::{Address, AttachmentInfo};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::config::Config;
use crate::protocol::{RenderCache, body_url, render_cached};

pub struct Inner {
    lib: Mutex<Option<Library>>,
    /// Outside the library mutex so `import_cancel` never waits on the lock.
    cancel: Arc<AtomicBool>,
    pending: Mutex<Option<ScanReport>>,
    cache: RenderCache,
    config_path: PathBuf,
    session_dir: PathBuf,
}

#[derive(Clone)]
pub struct AppState(Arc<Inner>);

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl AppState {
    pub fn new(lib: Option<Library>, config_path: PathBuf, session_dir: PathBuf) -> AppState {
        AppState(Arc::new(Inner {
            lib: Mutex::new(lib),
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

    /// Raw bytes of a message; the library lock is released before returning.
    pub fn raw(&self, id: i64) -> Option<Vec<u8>> {
        lock(&self.0.lib).as_ref()?.raw(id).ok()
    }

    pub fn message_and_raw(&self, id: i64) -> Option<(MessageRow, Vec<u8>)> {
        let g = lock(&self.0.lib);
        let lib = g.as_ref()?;
        Some((lib.message(id).ok()?, lib.raw(id).ok()?))
    }

    fn with_lib<T>(&self, f: impl FnOnce(&Library) -> Result<T, Error>) -> Result<T, String> {
        let g = lock(&self.0.lib);
        let lib = g
            .as_ref()
            .ok_or_else(|| "no library is configured".to_string())?;
        f(lib).map_err(|e| err_text(&e))
    }

    fn with_lib_mut<T>(
        &self,
        f: impl FnOnce(&mut Library) -> Result<T, Error>,
    ) -> Result<T, String> {
        let mut g = lock(&self.0.lib);
        let lib = g
            .as_mut()
            .ok_or_else(|| "no library is configured".to_string())?;
        f(lib).map_err(|e| err_text(&e))
    }
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

#[derive(Serialize)]
pub struct LibraryStatus {
    pub path: String,
    pub configured: bool,
    pub message_count: u64,
    pub needs_rebuild: bool,
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
                let body = render_cached(&st, r.id, &raw, &terms);
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
    let (row, raw) = st
        .message_and_raw(msg_id)
        .ok_or_else(|| "message not found".to_string())?;
    let info = row
        .attachments
        .into_iter()
        .find(|a| a.part_index == part)
        .ok_or_else(|| "attachment not found".to_string())?;
    let bytes = mail_core::parse::attachment_bytes(&raw, part)
        .ok_or_else(|| "attachment could not be read".to_string())?;
    Ok((info, bytes))
}

/// A safe single path component: no separators, no leading dot, bounded length.
pub fn sanitize_filename(name: Option<&str>) -> String {
    let cleaned: String = name
        .unwrap_or("")
        .chars()
        .map(|c| {
            if c == '/' || c == '\\' || c == ':' || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.');
    let cleaned: String = cleaned.chars().take(120).collect();
    if cleaned.trim().is_empty() {
        "attachment".to_string()
    } else {
        cleaned
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
        mail_core::paths::create_private_dir(&dir).map_err(|_| "file error".to_string())?;
        let file = dir.join(sanitize_filename(info.filename.as_deref()));
        {
            use std::io::Write;
            let mut f = mail_core::paths::create_private_file(&file)
                .map_err(|_| "file error".to_string())?;
            f.write_all(&bytes).map_err(|_| "file error".to_string())?;
        }
        Command::new("/usr/bin/open")
            .arg(&file)
            .spawn()
            .map(|_| ())
            .map_err(|_| "could not open the file".to_string())
    })
    .await
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
        let (_, bytes) = attachment_part(&st, msg_id, part)?;
        std::fs::write(&dest, bytes).map_err(|_| "could not save the file".to_string())
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
    // Single argument, no shell.
    Command::new("/usr/bin/open")
        .arg(&url)
        .spawn()
        .map(|_| ())
        .map_err(|_| "could not open the link".to_string())
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
        st.0.cancel.store(false, Ordering::SeqCst);
        *lock(&st.0.pending) = None;
        let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
        let cancel = st.0.cancel.clone();
        let report =
            st.with_lib(|l| mail_core::import::scan::scan(l, &paths, &progress, &cancel))?;
        let json = serde_json::to_value(&report).map_err(|_| "internal error".to_string())?;
        *lock(&st.0.pending) = Some(report);
        Ok(json)
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
    blocking(move || {
        let report = lock(&st.0.pending)
            .take()
            .ok_or_else(|| "no scan is pending; scan first".to_string())?;
        st.0.cancel.store(false, Ordering::SeqCst);
        let cancel = st.0.cancel.clone();
        st.with_lib_mut(|l| mail_core::import::apply::apply(l, &report, &progress, &cancel))
    })
    .await
}

#[tauri::command]
pub fn import_cancel(state: State<'_, AppState>) {
    state.0.cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub async fn rebuild_index(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let st = state.inner().clone();
    let progress = emit_progress(&app);
    blocking(move || {
        st.0.cancel.store(false, Ordering::SeqCst);
        let cancel = st.0.cancel.clone();
        let r = st.with_lib_mut(|l| l.rebuild(&progress, &cancel).map(|_| ()));
        st.0.cache.clear();
        r
    })
    .await
}

#[tauri::command]
pub async fn library_status(state: State<'_, AppState>) -> Result<LibraryStatus, String> {
    let st = state.inner().clone();
    blocking(move || {
        let g = lock(&st.0.lib);
        Ok(match g.as_ref() {
            Some(l) => LibraryStatus {
                path: l.dir().display().to_string(),
                configured: true,
                message_count: l.count().unwrap_or(0),
                needs_rebuild: l.needs_rebuild(),
            },
            None => LibraryStatus {
                path: Config::load_from(&st.0.config_path)
                    .library_path
                    .unwrap_or_else(mail_core::paths::default_library_dir)
                    .display()
                    .to_string(),
                configured: false,
                message_count: 0,
                needs_rebuild: false,
            },
        })
    })
    .await
}

#[tauri::command]
pub async fn set_library_path(
    state: State<'_, AppState>,
    path: String,
) -> Result<Option<String>, String> {
    let st = state.inner().clone();
    blocking(move || {
        let dir = PathBuf::from(&path);
        if !dir.is_absolute() {
            return Err("the library path must be absolute".to_string());
        }
        let warning = mail_core::paths::cloud_sync_warning(&dir).map(str::to_string);
        {
            let mut g = lock(&st.0.lib);
            if g.as_ref().is_none_or(|l| l.dir() != dir) {
                // Release the old library (and its lock) only once the new one opened.
                let new = Library::open(&dir).map_err(|e| err_text(&e))?;
                *g = Some(new);
            }
        }
        st.0.cache.clear();
        *lock(&st.0.pending) = None;
        Config {
            library_path: Some(dir),
        }
        .save_to(&st.0.config_path)
        .map_err(|_| "could not save settings".to_string())?;
        Ok(warning)
    })
    .await
}

/// Test helpers shared with protocol tests.
#[cfg(test)]
pub mod test_support {
    use super::*;
    use mail_core::testing::{MsgBuilder, mbox_of};

    /// An AppState over a real library imported from synthetic messages.
    pub fn state_with(msgs: &[MsgBuilder]) -> (AppState, Vec<i64>, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let mbox = dir.path().join("in.mbox");
        std::fs::write(
            &mbox,
            mbox_of(&msgs.iter().map(|m| m.build()).collect::<Vec<_>>()),
        )
        .unwrap();
        let mut lib = Library::open(&dir.path().join("lib")).unwrap();
        lib.import(&[mbox], &|_| {}, &AtomicBool::new(false))
            .unwrap();
        let mut ids = Vec::new();
        // Ids are assigned in order starting at 1.
        for i in 1..=msgs.len() as i64 {
            assert!(lib.message(i).is_ok());
            ids.push(i);
        }
        let st = AppState::new(
            Some(lib),
            dir.path().join("config.json"),
            dir.path().join("session"),
        );
        (st, ids, dir)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert!(!sanitize_filename(Some(&"x".repeat(500))).is_empty());
        assert!(sanitize_filename(Some(&"x".repeat(500))).len() <= 120);
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
        use mail_core::testing::MsgBuilder;
        let (st, ids, _d) = test_support::state_with(&[MsgBuilder::new()
            .from("a@example.com")
            .subject("Att")
            .thrid(1)
            .date_rfc2822("Mon, 01 Jun 2020 10:00:00 +0000")
            .message_id(Some("<a@x>"))
            .text("hi")
            .attach("doc.txt", "text/plain", b"hello")]);
        let row = st.message_and_raw(ids[0]).unwrap().0;
        let part = row.attachments[0].part_index;
        let (info, bytes) = attachment_part(&st, ids[0], part).unwrap();
        assert_eq!(info.filename.as_deref(), Some("doc.txt"));
        assert_eq!(bytes, b"hello");
        assert!(attachment_part(&st, ids[0], 99).is_err());
        assert!(attachment_part(&st, 999, 0).is_err());
        // import_apply with no pending scan is an error.
        assert!(lock(&st.0.pending).is_none());
    }
}
