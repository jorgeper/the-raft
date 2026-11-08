//! Query execution: [`Expr`] -> Tantivy query, top-N collection by date, and
//! grouping of matching messages into threads.

use std::collections::HashMap;
use std::ops::Bound;

use serde::Serialize;
use tantivy::collector::{Count, MultiCollector, TopDocs};
use tantivy::query::{AllQuery, BooleanQuery, Occur, PhraseQuery, Query, RangeQuery, TermQuery};
use tantivy::schema::{Field, IndexRecordOption};
use tantivy::{Order, Term as TTerm};

use crate::Result;
use crate::index::SearchIndex;
use crate::meta::MsgSummary;
use crate::model::MsgId;
use crate::query::{Age, AgeUnit, Chip, Expr, Flag, Hint, Location, Term};

/// Matching messages kept for thread grouping.
pub const MAX_COLLECTED: usize = 5_000;

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct ThreadHit {
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
    tz_offset_secs: i32,
}

type Q = Box<dyn Query>;

/// Build the Tantivy query for `expr` (`None` = recent mail). Spam and Trash
/// are excluded unless the expression mentions `in:spam|trash|anywhere`.
pub fn build_query(si: &SearchIndex, expr: Option<&Expr>, now: i64, tz_offset_secs: i32) -> Q {
    let cx = Ctx {
        si,
        now,
        tz_offset_secs,
    };
    let body: Q = expr
        .and_then(|e| build(&cx, e))
        .unwrap_or_else(|| Box::new(AllQuery));
    if expr.is_some_and(mentions_location) {
        return body;
    }
    let mut clauses = vec![(Occur::Must, body)];
    for l in ["spam", "trash"] {
        clauses.push((Occur::MustNot, label_term(&cx, l)));
    }
    Box::new(BooleanQuery::new(clauses))
}

fn mentions_location(e: &Expr) -> bool {
    match e {
        Expr::And(v) | Expr::Or(v) => v.iter().any(mentions_location),
        Expr::Not(x) => mentions_location(x),
        Expr::Term(Term::In(Location::Spam | Location::Trash | Location::Anywhere)) => true,
        Expr::Term(_) => false,
    }
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

fn local_midnight(cx: &Ctx, d: chrono::NaiveDate) -> i64 {
    d.and_hms_opt(0, 0, 0)
        .map(|dt| dt.and_utc().timestamp())
        .unwrap_or(0)
        - i64::from(cx.tz_offset_secs)
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
            Bound::Included(local_midnight(cx, *d)),
            Bound::Unbounded,
        )),
        Term::Before(d) => Some(date_range(
            cx,
            Bound::Unbounded,
            Bound::Excluded(local_midnight(cx, *d)),
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

/// Run `q`: the newest [`MAX_COLLECTED`] matches (date desc) and the full match count.
pub fn run(si: &SearchIndex, q: &dyn Query) -> Result<(Vec<Hit>, usize)> {
    let searcher = si.searcher();
    let mut mc = MultiCollector::new();
    let top = mc.add_collector(
        TopDocs::with_limit(MAX_COLLECTED)
            .order_by_fast_field::<i64>(crate::index::F_DATE, Order::Desc),
    );
    let count = mc.add_collector(Count);
    let mut fruit = searcher.search(q, &mc)?;
    let docs = top.extract(&mut fruit);
    let total = count.extract(&mut fruit);

    let mut cols = HashMap::new();
    let mut hits = Vec::with_capacity(docs.len());
    for (date, addr) in docs {
        let seg = addr.segment_ord;
        if let std::collections::hash_map::Entry::Vacant(v) = cols.entry(seg) {
            let ff = searcher.segment_reader(seg).fast_fields();
            v.insert((
                ff.i64(crate::index::F_MSG_ID)?,
                ff.i64(crate::index::F_THRID)?,
            ));
        }
        let (msg_col, thr_col) = &cols[&seg];
        let (Some(msg_id), Some(thrid)) = (msg_col.first(addr.doc_id), thr_col.first(addr.doc_id))
        else {
            continue;
        };
        hits.push(Hit {
            msg_id,
            thrid,
            date: date.unwrap_or(0),
        });
    }
    Ok((hits, total))
}

/// Group hits (date desc) by thread, preserving first appearance.
pub fn group_threads(hits: &[Hit]) -> Vec<ThreadGroup> {
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
