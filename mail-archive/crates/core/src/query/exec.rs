//! Query execution: [`Expr`] -> Tantivy query, top-N collection by date, and
//! grouping of matching messages into threads.

use std::collections::HashMap;
use std::ops::Bound;
use std::sync::Arc;

use chrono::{NaiveDate, TimeZone};
use serde::Serialize;
use tantivy::collector::{Count, MultiCollector, TopDocs};
use tantivy::columnar::ColumnValues;
use tantivy::query::{AllQuery, BooleanQuery, Occur, PhraseQuery, Query, RangeQuery, TermQuery};
use tantivy::schema::{Field, IndexRecordOption};
use tantivy::{DocId, Score, SegmentReader, Term as TTerm};

use crate::index::SearchIndex;
use crate::meta::MsgSummary;
use crate::model::MsgId;
use crate::query::{Age, AgeUnit, Chip, Expr, Flag, Hint, Location, Term};
use crate::{Error, Result};

/// Matching messages kept for thread grouping.
pub const MAX_COLLECTED: usize = 5_000;

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct ThreadHit {
    /// A decimal string in JSON (see [`crate::model::thread_id_string`]).
    #[serde(with = "crate::model::thread_id_string")]
    pub thrid: i64,
    pub latest_date: i64,
    pub senders: Vec<String>,
    pub message_count: u32,
    pub subject: String,
    pub snippet: String,
    pub has_attachment: bool,
    pub matched: Vec<MsgId>,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct SearchResults {
    pub threads: Vec<ThreadHit>,
    pub total_messages: usize,
    /// More messages matched than the newest [`MAX_COLLECTED`] that threads
    /// are grouped from: older matches are not in any page.
    pub capped: bool,
    pub elapsed_ms: f64,
    pub chips: Vec<Chip>,
    pub hints: Vec<Hint>,
    pub terms: Vec<String>,
}

/// One matching message, as collected from the index.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Hit {
    pub msg_id: MsgId,
    pub thrid: i64,
    pub date: i64,
}

/// Matching messages of one thread, newest first.
#[derive(Clone, Debug, PartialEq)]
pub struct ThreadGroup {
    pub thrid: i64,
    pub latest_date: i64,
    pub matched: Vec<MsgId>,
}

struct Ctx<'a> {
    si: &'a SearchIndex,
    now: i64,
    /// Unix time of local midnight starting the given date.
    midnight: &'a dyn Fn(NaiveDate) -> i64,
}

/// Local midnight of `d` in `tz`: the earlier instant if ambiguous, and the
/// first valid instant after the gap if midnight does not exist (DST).
pub fn local_midnight<Tz: TimeZone>(tz: &Tz, d: NaiveDate) -> i64 {
    let Some(mid) = d.and_hms_opt(0, 0, 0) else {
        return 0;
    };
    if let Some(t) = tz.from_local_datetime(&mid).earliest() {
        return t.timestamp();
    }
    for minutes in 1..=24 * 60 {
        let probe = mid + chrono::Duration::minutes(minutes);
        if let Some(t) = tz.from_local_datetime(&probe).earliest() {
            return t.timestamp();
        }
    }
    mid.and_utc().timestamp()
}

type Q = Box<dyn Query>;

/// Build the Tantivy query for `expr` (`None` = recent mail). Spam and Trash
/// are excluded unless the expression mentions `in:spam|trash|anywhere`.
pub fn build_query<Tz: TimeZone>(si: &SearchIndex, expr: Option<&Expr>, now: i64, tz: &Tz) -> Q {
    let midnight = |d: NaiveDate| local_midnight(tz, d);
    let cx = Ctx {
        si,
        now,
        midnight: &midnight,
    };
    let body: Q = expr
        .and_then(|e| build(&cx, e))
        .unwrap_or_else(|| Box::new(AllQuery));
    let (spam_ok, trash_ok) = expr.map(lifted_exclusions).unwrap_or_default();
    let mut clauses = vec![(Occur::Must, body)];
    for (l, lifted) in [("spam", spam_ok), ("trash", trash_ok)] {
        if !lifted {
            clauses.push((Occur::MustNot, label_term(&cx, l)));
        }
    }
    if clauses.len() == 1 {
        return clauses.remove(0).1;
    }
    Box::new(BooleanQuery::new(clauses))
}

/// Which of (spam, trash) the expression positively asks for. A mention
/// under an odd number of negations lifts nothing.
fn lifted_exclusions(e: &Expr) -> (bool, bool) {
    fn walk(e: &Expr, negated: bool, out: &mut (bool, bool)) {
        match e {
            Expr::And(v) | Expr::Or(v) => v.iter().for_each(|c| walk(c, negated, out)),
            Expr::Not(x) => walk(x, !negated, out),
            Expr::Term(Term::In(l)) if !negated => match l {
                Location::Spam => out.0 = true,
                Location::Trash => out.1 = true,
                Location::Anywhere => *out = (true, true),
                _ => {}
            },
            Expr::Term(_) => {}
        }
    }
    let mut out = (false, false);
    walk(e, false, &mut out);
    out
}

/// `None` means the expression contributes no constraint.
fn build(cx: &Ctx, e: &Expr) -> Option<Q> {
    match e {
        Expr::Term(t) => build_term(cx, t),
        Expr::And(v) => {
            let mut clauses: Vec<(Occur, Q)> = Vec::new();
            for c in v {
                match c {
                    Expr::Not(inner) => {
                        if let Some(q) = build(cx, inner) {
                            clauses.push((Occur::MustNot, q));
                        }
                    }
                    _ => {
                        if let Some(q) = build(cx, c) {
                            clauses.push((Occur::Must, q));
                        }
                    }
                }
            }
            finish_and(clauses)
        }
        Expr::Or(v) => {
            let qs: Vec<(Occur, Q)> = v
                .iter()
                .filter_map(|c| build(cx, c))
                .map(|q| (Occur::Should, q))
                .collect();
            match qs.len() {
                0 => None,
                _ => Some(Box::new(BooleanQuery::new(qs))),
            }
        }
        Expr::Not(inner) => {
            let q = build(cx, inner)?;
            finish_and(vec![(Occur::MustNot, q)])
        }
    }
}

/// A boolean query needs a positive clause; add `AllQuery` if only negatives.
fn finish_and(mut clauses: Vec<(Occur, Q)>) -> Option<Q> {
    if clauses.is_empty() {
        return None;
    }
    if clauses.iter().all(|(o, _)| *o == Occur::MustNot) {
        clauses.push((Occur::Must, Box::new(AllQuery)));
    }
    Some(Box::new(BooleanQuery::new(clauses)))
}

/// Term or phrase query for `value` normalized with `field`'s analyzer.
fn field_query(cx: &Ctx, field: Field, value: &str) -> Option<Q> {
    let mut toks = cx.si.tokenize(field, value);
    match toks.len() {
        0 => None,
        1 => Some(Box::new(TermQuery::new(
            TTerm::from_field_text(field, &toks.remove(0)),
            IndexRecordOption::Basic,
        ))),
        _ => Some(Box::new(PhraseQuery::new(
            toks.iter()
                .map(|t| TTerm::from_field_text(field, t))
                .collect(),
        ))),
    }
}

fn any_of(qs: Vec<Q>) -> Option<Q> {
    match qs.len() {
        0 => None,
        1 => qs.into_iter().next(),
        _ => Some(Box::new(BooleanQuery::union(qs))),
    }
}

fn across(cx: &Ctx, fields: &[Field], value: &str) -> Option<Q> {
    any_of(
        fields
            .iter()
            .filter_map(|f| field_query(cx, *f, value))
            .collect(),
    )
}

/// Exact label token (analyzer-normalized).
fn label_term(cx: &Ctx, name: &str) -> Q {
    let f = cx.si.fields().labels;
    let tok = cx
        .si
        .tokenize(f, name)
        .pop()
        .unwrap_or_else(|| name.to_string());
    Box::new(TermQuery::new(
        TTerm::from_field_text(f, &tok),
        IndexRecordOption::Basic,
    ))
}

/// Label matching `value` or `value` with `-` replaced by a space.
fn label_query(cx: &Ctx, value: &str) -> Option<Q> {
    let f = cx.si.fields().labels;
    let mut toks: Vec<String> = Vec::new();
    for v in [value.to_string(), value.replace('-', " ")] {
        for t in cx.si.tokenize(f, &v) {
            if !toks.contains(&t) {
                toks.push(t);
            }
        }
    }
    any_of(
        toks.iter()
            .map(|t| -> Q {
                Box::new(TermQuery::new(
                    TTerm::from_field_text(f, t),
                    IndexRecordOption::Basic,
                ))
            })
            .collect(),
    )
}

fn age_secs(a: Age) -> i64 {
    let unit = match a.unit {
        AgeUnit::Day => 1,
        AgeUnit::Month => 30,
        AgeUnit::Year => 365,
    };
    i64::from(a.n) * unit * 86_400
}

fn date_range(cx: &Ctx, lower: Bound<i64>, upper: Bound<i64>) -> Q {
    let f = cx.si.fields().date;
    let m = |b: Bound<i64>| match b {
        Bound::Included(v) => Bound::Included(TTerm::from_field_i64(f, v)),
        Bound::Excluded(v) => Bound::Excluded(TTerm::from_field_i64(f, v)),
        Bound::Unbounded => Bound::Unbounded,
    };
    Box::new(RangeQuery::new(m(lower), m(upper)))
}

fn build_term(cx: &Ctx, t: &Term) -> Option<Q> {
    let f = cx.si.fields();
    match t {
        Term::Text(w) => across(cx, &[f.subject, f.body, f.from, f.to, f.cc, f.filenames], w),
        Term::Phrase(p) => across(cx, &[f.subject, f.body], p),
        Term::From(v) => field_query(cx, f.from, v),
        Term::To(v) => field_query(cx, f.to, v),
        Term::Cc(v) => field_query(cx, f.cc, v),
        Term::Bcc(v) => field_query(cx, f.bcc, v),
        Term::Subject(v) => field_query(cx, f.subject, v),
        Term::Filename(v) => field_query(cx, f.filenames, v),
        Term::Label(v) => label_query(cx, v),
        Term::Category(v) => label_query(cx, &format!("category {v}")),
        Term::In(l) => match l {
            Location::Inbox => Some(label_term(cx, "inbox")),
            Location::Sent => Some(label_term(cx, "sent")),
            Location::Spam => Some(label_term(cx, "spam")),
            Location::Trash => Some(label_term(cx, "trash")),
            Location::Anywhere => None,
        },
        Term::Is(flag) => match flag {
            Flag::Starred => Some(label_term(cx, "starred")),
            Flag::Important => Some(label_term(cx, "important")),
            Flag::Unread => Some(label_term(cx, "unread")),
            Flag::Removed => Some(Box::new(TermQuery::new(
                TTerm::from_field_bool(f.removed, true),
                IndexRecordOption::Basic,
            ))),
        },
        Term::HasAttachment => Some(Box::new(TermQuery::new(
            TTerm::from_field_bool(f.has_attachment, true),
            IndexRecordOption::Basic,
        ))),
        Term::After(d) => Some(date_range(
            cx,
            Bound::Included((cx.midnight)(*d)),
            Bound::Unbounded,
        )),
        Term::Before(d) => Some(date_range(
            cx,
            Bound::Unbounded,
            Bound::Excluded((cx.midnight)(*d)),
        )),
        Term::OlderThan(a) => Some(date_range(
            cx,
            Bound::Unbounded,
            Bound::Excluded(cx.now - age_secs(*a)),
        )),
        Term::NewerThan(a) => Some(date_range(
            cx,
            Bound::Included(cx.now - age_secs(*a)),
            Bound::Unbounded,
        )),
        Term::Larger(n) => Some(Box::new(RangeQuery::new(
            Bound::Excluded(TTerm::from_field_u64(f.size, *n)),
            Bound::Unbounded,
        ))),
        Term::Smaller(n) => Some(Box::new(RangeQuery::new(
            Bound::Unbounded,
            Bound::Excluded(TTerm::from_field_u64(f.size, *n)),
        ))),
    }
}

/// Run `q`: the newest [`MAX_COLLECTED`] matches and the full match count.
///
/// Order is total and independent of index doc order: date desc, then thrid
/// desc, then msg id desc. Msg ids are unique and are assigned in event-log
/// order, so they are identical after a rebuild.
pub fn run(si: &SearchIndex, q: &dyn Query) -> Result<(Vec<Hit>, usize)> {
    let searcher = si.searcher();
    // Fail loudly on a missing or corrupt sort column instead of keying it as 0.
    for seg in searcher.segment_readers() {
        for name in [
            crate::index::F_DATE,
            crate::index::F_THRID,
            crate::index::F_MSG_ID,
        ] {
            seg.fast_fields()
                .i64(name)
                .map_err(|e| Error::Index(format!("fast field {name}: {e}")))?;
        }
    }
    let mut mc = MultiCollector::new();
    let top = mc.add_collector(TopDocs::with_limit(MAX_COLLECTED).tweak_score(
        |seg: &SegmentReader| {
            let ff = seg.fast_fields();
            // Validated above for every segment; the fallback is unreachable.
            let col = |name: &str| ff.i64(name).ok().map(|c| c.first_or_default_col(0));
            let (date, thrid, msg) = (
                col(crate::index::F_DATE),
                col(crate::index::F_THRID),
                col(crate::index::F_MSG_ID),
            );
            move |doc: DocId, _score: Score| {
                let get = |c: &Option<_>| {
                    c.as_ref()
                        .map_or(0, |c: &Arc<dyn ColumnValues<i64>>| c.get_val(doc))
                };
                (get(&date), get(&thrid), get(&msg))
            }
        },
    ));
    let count = mc.add_collector(Count);
    let mut fruit = searcher.search(q, &mc)?;
    let docs = top.extract(&mut fruit);
    let total = count.extract(&mut fruit);

    let hits = docs
        .into_iter()
        .map(|((date, thrid, msg_id), _)| Hit {
            msg_id,
            thrid,
            date,
        })
        .collect();
    Ok((hits, total))
}

/// Group hits (date desc, thrid desc, msg id desc) by thread. Threads end up
/// ordered by `latest_date` desc, then `thrid` desc; `matched` keeps hit order.
pub fn group_threads(hits: &[Hit]) -> Vec<ThreadGroup> {
    debug_assert!(
        hits.windows(2)
            .all(|w| (w[0].date, w[0].thrid, w[0].msg_id) >= (w[1].date, w[1].thrid, w[1].msg_id)),
        "hits must be sorted by (date, thrid, msg id) desc"
    );
    let mut pos: HashMap<i64, usize> = HashMap::new();
    let mut out: Vec<ThreadGroup> = Vec::new();
    for h in hits {
        match pos.get(&h.thrid) {
            Some(&i) => out[i].matched.push(h.msg_id),
            None => {
                pos.insert(h.thrid, out.len());
                out.push(ThreadGroup {
                    thrid: h.thrid,
                    latest_date: h.date,
                    matched: vec![h.msg_id],
                });
            }
        }
    }
    // Defensive: already implied by the hit order; keeps the contract local.
    out.sort_by_key(|g| std::cmp::Reverse((g.latest_date, g.thrid)));
    out
}

/// Assemble the result row for a group from its thread's messages (oldest first).
pub fn thread_hit(g: ThreadGroup, msgs: &[MsgSummary]) -> ThreadHit {
    let mut senders: Vec<String> = Vec::new();
    for m in msgs {
        let s = m
            .from_name
            .as_deref()
            .filter(|n| !n.is_empty())
            .or(m.from_addr.as_deref())
            .unwrap_or("")
            .to_string();
        if !s.is_empty() && !senders.contains(&s) {
            senders.push(s);
            if senders.len() == 3 {
                break;
            }
        }
    }
    let last = msgs.last();
    ThreadHit {
        thrid: g.thrid,
        latest_date: g.latest_date,
        senders,
        message_count: msgs.len() as u32,
        subject: last.map(|m| m.subject.clone()).unwrap_or_default(),
        snippet: last.map(|m| m.snippet.clone()).unwrap_or_default(),
        has_attachment: msgs.iter().any(|m| m.has_attachments),
        matched: g.matched,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::FixedOffset;

    #[test]
    fn midnight_in_fixed_offset() {
        let tz = FixedOffset::west_opt(8 * 3600).unwrap();
        let d = NaiveDate::from_ymd_opt(2020, 1, 1).unwrap();
        assert_eq!(local_midnight(&tz, d), 1_577_836_800 + 8 * 3600);
    }

    #[test]
    fn midnight_gap_uses_first_valid_instant() {
        // Sao Paulo skipped 2018-11-04 00:00-01:00 (DST start): the day begins at 01:00 -02:00.
        let d = NaiveDate::from_ymd_opt(2018, 11, 4).unwrap();
        let want = chrono::NaiveDate::from_ymd_opt(2018, 11, 4)
            .unwrap()
            .and_hms_opt(3, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp();
        assert_eq!(local_midnight(&chrono_tz::America::Sao_Paulo, d), want);
    }
}
