//! `mail-cli`: import, search, rebuild and benchmark a local mail library.

use std::cell::Cell;
use std::io::{self, BufRead, IsTerminal, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use chrono::{Local, TimeZone, Utc};
use clap::{Parser, Subcommand};
use mail_core::import::scan::Progress;
use mail_core::library::Library;
use mail_core::{Error, paths};

const PROGRESS_EVERY: Duration = Duration::from_millis(100);
const PLAIN_PROGRESS_EVERY: Duration = Duration::from_secs(5);
const BENCH_RUNS: usize = 5;
const BENCH_LIMIT: usize = 50;

/// Generic queries that reveal nothing about the archive's owner.
const BENCH_QUERIES: [&str; 20] = [
    "has:attachment",
    "in:inbox",
    "is:starred",
    "after:2015/01/01 before:2016/01/01",
    "larger:5M",
    "filename:pdf",
    "subject:invoice",
    "receipt",
    "\"thank you\"",
    "-in:inbox",
    "older_than:5y",
    "category:promotions",
    "in:sent",
    "in:anywhere meeting",
    "label:important",
    "from:noreply",
    "to:me",
    "newer_than:1y has:attachment",
    "hello OR thanks",
    "",
];

#[derive(Parser)]
#[command(name = "mail-cli", about = "Import and search a local Gmail archive")]
struct Cli {
    /// Library directory (default: ~/Library/Application Support/mail-archive/library).
    #[arg(long, global = true)]
    library: Option<PathBuf>,
    #[command(subcommand)]
    command: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Scan Takeout zip/mbox files, show what would change, then import.
    Import {
        #[arg(required = true)]
        paths: Vec<PathBuf>,
        /// Do not ask for confirmation.
        #[arg(short, long)]
        yes: bool,
    },
    /// Run a Gmail-style query and print one line per thread.
    Search {
        query: String,
        #[arg(long, default_value_t = 50)]
        limit: usize,
    },
    /// Rebuild the SQLite database and search index from the store.
    Rebuild,
    /// Time 20 generic queries and print latency percentiles only.
    Bench,
}

/// Throttled progress on stderr: one redrawn line on a terminal, an
/// occasional plain line otherwise.
struct ProgressLine {
    started: Instant,
    last: Cell<Option<Instant>>,
    shown: Cell<bool>,
    tty: bool,
    /// Item count to measure `processed` against, when known.
    total_items: Option<u64>,
}

impl ProgressLine {
    fn new(total_items: Option<u64>) -> Self {
        Self {
            started: Instant::now(),
            last: Cell::new(None),
            shown: Cell::new(false),
            tty: io::stderr().is_terminal(),
            total_items,
        }
    }

    fn update(&self, p: &Progress) {
        let every = if self.tty {
            PROGRESS_EVERY
        } else {
            PLAIN_PROGRESS_EVERY
        };
        if self.last.get().is_some_and(|t| t.elapsed() < every) {
            return;
        }
        self.last.set(Some(Instant::now()));
        let mut line = format!(
            "{}: {} processed, {}/s",
            p.phase,
            fmt_int(p.processed),
            fmt_int(p.rate_per_sec as u64)
        );
        let frac = match (self.total_items, p.total_bytes) {
            (Some(t), _) if t > 0 => Some(p.processed as f64 / t as f64),
            (_, Some(t)) if t > 0 => Some(p.bytes as f64 / t as f64),
            _ => None,
        };
        if let Some(frac) = frac.map(|f| f.min(1.0)) {
            line.push_str(&format!(", {:.0}%", frac * 100.0));
            let secs = self.started.elapsed().as_secs_f64();
            if frac > 0.01 {
                line.push_str(&format!(", ETA {}", fmt_duration(secs / frac - secs)));
            }
        }
        if p.errors > 0 {
            line.push_str(&format!(", {} errors", fmt_int(p.errors)));
        }
        if self.tty {
            eprint!("\r\x1b[2K{line}");
            let _ = io::stderr().flush();
        } else {
            eprintln!("{line}");
        }
        self.shown.set(true);
    }

    /// Erase the line and reset throttling for the next phase.
    fn finish(&self) {
        if self.shown.replace(false) && self.tty {
            eprint!("\r\x1b[2K");
            let _ = io::stderr().flush();
        }
        self.last.set(None);
    }
}

/// Replace control characters (including ESC and C1 codes) so untrusted
/// mail headers cannot drive the terminal.
fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_control() { '?' } else { c })
        .collect()
}

fn fmt_int(n: u64) -> String {
    let s = n.to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

fn fmt_duration(secs: f64) -> String {
    let s = secs.max(0.0) as u64;
    if s >= 3600 {
        format!("{}h{:02}m", s / 3600, s % 3600 / 60)
    } else if s >= 60 {
        format!("{}m{:02}s", s / 60, s % 60)
    } else {
        format!("{s}s")
    }
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let idx = ((sorted.len() as f64 * p).ceil() as usize).clamp(1, sorted.len()) - 1;
    sorted[idx]
}

fn dir_size(p: &Path) -> u64 {
    let Ok(rd) = std::fs::read_dir(p) else {
        return 0;
    };
    rd.flatten()
        .map(|e| match e.metadata() {
            Ok(m) if m.is_dir() => dir_size(&e.path()),
            Ok(m) => m.len(),
            Err(_) => 0,
        })
        .sum()
}

fn fmt_size(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["KB", "MB", "GB", "TB"];
    if bytes < 1000 {
        return format!("{bytes} B");
    }
    let mut v = bytes as f64;
    let mut unit = "B";
    for u in UNITS {
        if v < 1000.0 {
            break;
        }
        v /= 1000.0;
        unit = u;
    }
    format!("{v:.1} {unit}")
}

fn now_secs() -> i64 {
    Utc::now().timestamp()
}

fn cmd_import(
    lib: &mut Library,
    paths: &[PathBuf],
    yes: bool,
    cancel: &AtomicBool,
) -> Result<ExitCode, Error> {
    if lib.needs_rebuild() {
        eprintln!("error: the library needs a rebuild before importing; run `mail-cli rebuild`");
        return Ok(ExitCode::FAILURE);
    }
    let progress = ProgressLine::new(None);
    let report = mail_core::import::scan::scan(lib, paths, &|p| progress.update(&p), cancel);
    progress.finish();
    let report = report?;

    println!(
        "{} already in library · {} new · {} label changes · {} no longer in Gmail (kept)",
        fmt_int(report.unchanged),
        fmt_int(report.new),
        fmt_int(report.label_changes),
        fmt_int(report.removed)
    );
    if report.parse_errors > 0 {
        println!("parse errors: {}", fmt_int(report.parse_errors));
    }
    if report.duplicates_in_source > 0 {
        println!(
            "duplicates in source: {}",
            fmt_int(report.duplicates_in_source)
        );
    }
    if report.removed_fraction > 0.05 {
        println!(
            "WARNING: {:.1}% of the library is missing from this source. Is it an older or partial export?",
            report.removed_fraction * 100.0
        );
    }
    if report.looks_older {
        println!("WARNING: this export looks older than what is already in the library.");
    }

    if !yes {
        print!("Import? [y/N] ");
        io::stdout().flush()?;
        let mut answer = String::new();
        io::stdin().lock().read_line(&mut answer)?;
        if !matches!(answer.trim(), "y" | "Y" | "yes" | "Yes") {
            println!("Aborted.");
            return Ok(ExitCode::FAILURE);
        }
    }

    let started = Instant::now();
    let progress = ProgressLine::new(Some(report.plan.total));
    let summary = mail_core::import::apply::apply(lib, &report, &|p| progress.update(&p), cancel);
    progress.finish();
    let s = summary?;
    println!(
        "Imported: {} added · {} relabelled · {} marked removed · {} parse errors",
        fmt_int(s.added),
        fmt_int(s.relabelled),
        fmt_int(s.removed_marked),
        fmt_int(s.parse_errors)
    );
    println!("Done in {}", fmt_duration(started.elapsed().as_secs_f64()));
    Ok(ExitCode::SUCCESS)
}

fn cmd_search(lib: &Library, query: &str, limit: usize) -> Result<ExitCode, Error> {
    let res = lib.search(query, 0, limit, now_secs(), &Local)?;
    for t in &res.threads {
        let date = Local.timestamp_opt(t.latest_date, 0).single().map_or_else(
            || "?".to_string(),
            |d| d.format("%Y-%m-%d %H:%M").to_string(),
        );
        let count = if t.message_count > 1 {
            format!(" ({})", t.message_count)
        } else {
            String::new()
        };
        println!(
            "{date} · {} · {}{count}",
            sanitize(&t.senders.join(", ")),
            sanitize(&t.subject)
        );
    }
    println!("{} messages · {:.0} ms", res.total_messages, res.elapsed_ms);
    Ok(ExitCode::SUCCESS)
}

fn cmd_rebuild(lib: &mut Library, cancel: &AtomicBool) -> Result<ExitCode, Error> {
    let started = Instant::now();
    let progress = ProgressLine::new(None);
    let summary = lib.rebuild(&|p| progress.update(&p), cancel);
    progress.finish();
    let s = summary?;
    println!(
        "Rebuilt in {} · parse errors: {} · inconsistencies: {}",
        fmt_duration(started.elapsed().as_secs_f64()),
        fmt_int(s.parse_errors),
        fmt_int(s.inconsistencies)
    );
    Ok(ExitCode::SUCCESS)
}

fn cmd_bench(lib: &Library) -> Result<ExitCode, Error> {
    println!(
        "library: {} messages, {} on disk",
        fmt_int(lib.count()?),
        fmt_size(dir_size(lib.dir()))
    );
    let mut all = Vec::new();
    for q in BENCH_QUERIES {
        let run = |q: &str| -> Result<f64, Error> {
            let start = Instant::now();
            lib.search(q, 0, BENCH_LIMIT, now_secs(), &Local)?;
            Ok(start.elapsed().as_secs_f64() * 1000.0)
        };
        run(q)?; // warm-up
        let mut times = (0..BENCH_RUNS)
            .map(|_| run(q))
            .collect::<Result<Vec<_>, _>>()?;
        all.extend_from_slice(&times);
        times.sort_by(f64::total_cmp);
        println!(
            "{:<40} p50 {:8.1} ms  p95 {:8.1} ms  max {:8.1} ms",
            format!("{q:?}"),
            percentile(&times, 0.5),
            percentile(&times, 0.95),
            times.last().copied().unwrap_or(0.0)
        );
    }
    all.sort_by(f64::total_cmp);
    println!(
        "overall: p50 {:.1} ms  p95 {:.1} ms  max {:.1} ms",
        percentile(&all, 0.5),
        percentile(&all, 0.95),
        all.last().copied().unwrap_or(0.0)
    );
    Ok(ExitCode::SUCCESS)
}

/// Make Ctrl-C set the returned flag so long operations roll back cleanly.
fn install_cancel() -> Arc<AtomicBool> {
    let cancel = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&cancel);
    if let Err(e) = ctrlc::set_handler(move || flag.store(true, Ordering::Relaxed)) {
        eprintln!("warning: cannot install Ctrl-C handler: {e}");
    }
    cancel
}

fn run(cli: Cli) -> Result<ExitCode, Error> {
    let dir = cli.library.unwrap_or_else(paths::default_library_dir);
    if let Some(w) = paths::cloud_sync_warning(&dir) {
        eprintln!("warning: {w}");
    }
    let mut lib = Library::open(&dir)?;
    match cli.command {
        Cmd::Import { paths, yes } => cmd_import(&mut lib, &paths, yes, &install_cancel()),
        Cmd::Search { query, limit } => cmd_search(&lib, &query, limit),
        Cmd::Rebuild => cmd_rebuild(&mut lib, &install_cancel()),
        Cmd::Bench => cmd_bench(&lib),
    }
}

fn main() -> ExitCode {
    match run(Cli::parse()) {
        Ok(code) => code,
        Err(Error::Cancelled) => {
            eprintln!("cancelled; nothing was changed");
            ExitCode::FAILURE
        }
        Err(Error::NeedsRebuild) => {
            eprintln!("error: the library needs a rebuild; run `mail-cli rebuild`");
            ExitCode::FAILURE
        }
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::sanitize;

    #[test]
    fn sanitize_removes_escapes() {
        let out = sanitize("a\x1b[2Jb\u{9b}c\n");
        assert!(!out.chars().any(char::is_control), "{out:?}");
        assert!(out.starts_with('a'));
    }
}
