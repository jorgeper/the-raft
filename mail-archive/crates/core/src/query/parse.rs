//! Hand-written tokenizer and recursive-descent parser for the Gmail-style query
//! language (spec section 9). Parsing never fails: odd input degrades to plain text,
//! is ignored, or produces a [`Hint`].
//!
//! Precedence: `-` binds tightest, then implicit AND, then `OR`.

use chrono::NaiveDate;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    And(Vec<Expr>),
    Or(Vec<Expr>),
    Not(Box<Expr>),
    Term(Term),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Term {
    Text(String),
    Phrase(String),
    From(String),
    To(String),
    Cc(String),
    Bcc(String),
    Subject(String),
    Label(String),
    Category(String),
    In(Location),
    Is(Flag),
    HasAttachment,
    Filename(String),
    After(NaiveDate),
    Before(NaiveDate),
    OlderThan(Age),
    NewerThan(Age),
    Larger(u64),
    Smaller(u64),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Location {
    Inbox,
    Sent,
    Spam,
    Trash,
    Anywhere,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Flag {
    Starred,
    Important,
    Unread,
    Removed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Age {
    pub n: u32,
    pub unit: AgeUnit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgeUnit {
    Day,
    Month,
    Year,
}

/// One chip per operator term; `start..end` is a byte span in the input.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Chip {
    pub start: usize,
    pub end: usize,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Hint {
    pub start: usize,
    pub end: usize,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedQuery {
    pub expr: Option<Expr>,
    pub chips: Vec<Chip>,
    pub hints: Vec<Hint>,
    /// Plain words and phrases (not operator values, not negated) for highlighting.
    pub terms: Vec<String>,
}

const MAX_DEPTH: usize = 48;

#[derive(Debug, Clone, Copy, PartialEq)]
enum Tok {
    LParen,
    RParen,
    LBrace,
    RBrace,
    Or,
    Minus,
    Phrase,
    Word,
}

#[derive(Debug, Clone, Copy)]
struct Token {
    kind: Tok,
    start: usize,
    end: usize,
}

fn tokenize(input: &str) -> Vec<Token> {
    let mut toks = Vec::new();
    let mut it = input.char_indices().peekable();
    while let Some(&(i, c)) = it.peek() {
        let single = |kind| Token {
            kind,
            start: i,
            end: i + c.len_utf8(),
        };
        match c {
            c if c.is_whitespace() => {
                it.next();
            }
            '(' | ')' | '{' | '}' => {
                it.next();
                toks.push(single(match c {
                    '(' => Tok::LParen,
                    ')' => Tok::RParen,
                    '{' => Tok::LBrace,
                    _ => Tok::RBrace,
                }));
            }
            '-' => {
                it.next();
                if it.peek().is_some_and(|&(_, n)| !n.is_whitespace()) {
                    toks.push(single(Tok::Minus));
                }
            }
            '"' => {
                it.next();
                let mut end = input.len();
                for (j, ch) in it.by_ref() {
                    if ch == '"' {
                        end = j + 1;
                        break;
                    }
                }
                toks.push(Token {
                    kind: Tok::Phrase,
                    start: i,
                    end,
                });
            }
            _ => {
                let mut end = i;
                let mut last = ' ';
                while let Some(&(j, ch)) = it.peek() {
                    if ch.is_whitespace() || matches!(ch, '(' | ')' | '{' | '}') {
                        break;
                    }
                    if ch == '"' {
                        if last != ':' {
                            break;
                        }
                        // quoted operator value; ends the word
                        it.next();
                        end = input.len();
                        for (k, q) in it.by_ref() {
                            if q == '"' {
                                end = k + 1;
                                break;
                            }
                        }
                        break;
                    }
                    it.next();
                    end = j + ch.len_utf8();
                    last = ch;
                }
                let kind = if &input[i..end] == "OR" {
                    Tok::Or
                } else {
                    Tok::Word
                };
                toks.push(Token {
                    kind,
                    start: i,
                    end,
                });
            }
        }
    }
    toks
}

fn unquote(raw: &str) -> &str {
    match raw.strip_prefix('"') {
        Some(inner) => inner.strip_suffix('"').unwrap_or(inner),
        None => raw,
    }
}

fn parse_date(s: &str) -> Option<NaiveDate> {
    let sep = if s.contains('/') { '/' } else { '-' };
    let mut parts = s.split(sep);
    let (y, m, d) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() || y.len() != 4 || m.len() > 2 || d.len() > 2 {
        return None;
    }
    let num = |p: &str| {
        p.bytes()
            .all(|b| b.is_ascii_digit())
            .then(|| p.parse::<u32>().ok())
            .flatten()
    };
    NaiveDate::from_ymd_opt(num(y)? as i32, num(m)?, num(d)?)
}

fn parse_age(s: &str) -> Option<Age> {
    let unit = match s.chars().last()?.to_ascii_lowercase() {
        'd' => AgeUnit::Day,
        'm' => AgeUnit::Month,
        'y' => AgeUnit::Year,
        _ => return None,
    };
    let digits = &s[..s.len() - 1];
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some(Age {
        n: digits.parse().ok()?,
        unit,
    })
}

fn parse_size(s: &str) -> Option<u64> {
    let (digits, mult) = match s.chars().last()?.to_ascii_lowercase() {
        'k' => (&s[..s.len() - 1], 1u64 << 10),
        'm' => (&s[..s.len() - 1], 1 << 20),
        'g' => (&s[..s.len() - 1], 1 << 30),
        _ => (s, 1),
    };
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse::<u64>().ok()?.checked_mul(mult)
}

fn label_for(negated: bool, name: &str, shown: &str) -> String {
    if negated {
        format!("not {name}: {shown}")
    } else {
        format!("{name}: {shown}")
    }
}

fn age_label(a: Age) -> String {
    let u = match a.unit {
        AgeUnit::Day => 'd',
        AgeUnit::Month => 'm',
        AgeUnit::Year => 'y',
    };
    format!("{}{u}", a.n)
}

struct Parser<'a> {
    input: &'a str,
    toks: Vec<Token>,
    pos: usize,
    depth: usize,
    negated: bool,
    chips: Vec<Chip>,
    hints: Vec<Hint>,
    terms: Vec<String>,
}

fn collapse(mut items: Vec<Expr>, make: fn(Vec<Expr>) -> Expr) -> Option<Expr> {
    match items.len() {
        0 => None,
        1 => items.pop(),
        _ => Some(make(items)),
    }
}

impl Parser<'_> {
    fn peek(&self) -> Option<Tok> {
        self.toks.get(self.pos).map(|t| t.kind)
    }

    fn parse_or(&mut self) -> Option<Expr> {
        let mut items = Vec::new();
        loop {
            items.extend(self.parse_and());
            if self.peek() == Some(Tok::Or) {
                self.pos += 1;
            } else {
                break;
            }
        }
        collapse(items, Expr::Or)
    }

    fn parse_and(&mut self) -> Option<Expr> {
        let mut items = Vec::new();
        while !matches!(
            self.peek(),
            None | Some(Tok::Or | Tok::RParen | Tok::RBrace)
        ) {
            items.extend(self.parse_unary());
        }
        collapse(items, Expr::And)
    }

    /// Always consumes at least one token.
    fn parse_unary(&mut self) -> Option<Expr> {
        let mut minus_start = None;
        let mut minuses = 0;
        while self.peek() == Some(Tok::Minus) {
            minus_start.get_or_insert(self.toks[self.pos].start);
            minuses += 1;
            self.pos += 1;
        }
        let negate = minuses % 2 == 1;
        let saved = self.negated;
        if negate {
            self.negated = !saved;
        }
        let chip_minus = minus_start;
        let inner = match self.peek() {
            None => None,
            Some(Tok::Or) | Some(Tok::RParen) | Some(Tok::RBrace) => {
                // dangling "-" before a delimiter; leave the delimiter to the caller
                None
            }
            Some(Tok::LParen) => self.group(false),
            Some(Tok::LBrace) => self.group(true),
            Some(Tok::Phrase) => {
                let t = self.toks[self.pos];
                self.pos += 1;
                let text = unquote(&self.input[t.start..t.end]);
                if text.trim().is_empty() {
                    None
                } else {
                    self.note_plain(text);
                    Some(Expr::Term(Term::Phrase(text.to_string())))
                }
            }
            Some(Tok::Word) | Some(Tok::Minus) => {
                let t = self.toks[self.pos];
                self.pos += 1;
                self.word(t, chip_minus)
            }
        };
        self.negated = saved;
        match (inner, negate) {
            (Some(e), true) => Some(Expr::Not(Box::new(e))),
            (e, _) => e,
        }
    }

    fn group(&mut self, brace: bool) -> Option<Expr> {
        self.pos += 1; // opener
        if self.depth >= MAX_DEPTH {
            return None;
        }
        self.depth += 1;
        let result = if brace {
            let mut items = Vec::new();
            while !matches!(self.peek(), None | Some(Tok::RBrace | Tok::RParen)) {
                if self.peek() == Some(Tok::Or) {
                    self.pos += 1;
                } else {
                    items.extend(self.parse_unary());
                }
            }
            if self.peek() == Some(Tok::RBrace) {
                self.pos += 1;
            }
            collapse(items, Expr::Or)
        } else {
            let e = self.parse_or();
            if self.peek() == Some(Tok::RParen) {
                self.pos += 1;
            }
            e
        };
        self.depth -= 1;
        result
    }

    /// Record a plain word/phrase for highlighting (unless negated).
    fn note_plain(&mut self, text: &str) {
        if !self.negated && !self.terms.iter().any(|t| t == text) {
            self.terms.push(text.to_string());
        }
    }

    fn word(&mut self, t: Token, minus: Option<usize>) -> Option<Expr> {
        let raw = &self.input[t.start..t.end];
        let plain = |p: &mut Self| {
            p.note_plain(&raw.replace('"', ""));
            Some(Expr::Term(Term::Text(raw.to_string())))
        };
        let Some(colon) = raw.find(':') else {
            return plain(self);
        };
        let name = raw[..colon].to_ascii_lowercase();
        let known = matches!(
            name.as_str(),
            "from"
                | "to"
                | "cc"
                | "bcc"
                | "subject"
                | "label"
                | "category"
                | "in"
                | "is"
                | "has"
                | "filename"
                | "after"
                | "before"
                | "older_than"
                | "newer_than"
                | "larger"
                | "smaller"
        );
        if !known {
            return plain(self);
        }
        let value = unquote(&raw[colon + 1..]);
        if value.is_empty() {
            return None; // still typing
        }
        let lower = value.to_lowercase();
        let hint = |p: &mut Self, message: &str| {
            p.hints.push(Hint {
                start: t.start,
                end: t.end,
                message: message.to_string(),
            });
            None
        };
        let (term, shown): (Term, String) = match name.as_str() {
            "from" => (Term::From(value.to_string()), value.to_string()),
            "to" => (Term::To(value.to_string()), value.to_string()),
            "cc" => (Term::Cc(value.to_string()), value.to_string()),
            "bcc" => (Term::Bcc(value.to_string()), value.to_string()),
            "subject" => (Term::Subject(value.to_string()), value.to_string()),
            "filename" => (Term::Filename(value.to_string()), value.to_string()),
            "label" => (Term::Label(lower.clone()), lower),
            "category" => (Term::Category(lower.clone()), lower),
            "in" => {
                let loc = match lower.as_str() {
                    "inbox" => Location::Inbox,
                    "sent" => Location::Sent,
                    "spam" => Location::Spam,
                    "trash" => Location::Trash,
                    "anywhere" => Location::Anywhere,
                    _ => return plain(self),
                };
                (Term::In(loc), lower)
            }
            "is" => {
                let flag = match lower.as_str() {
                    "starred" => Flag::Starred,
                    "important" => Flag::Important,
                    "unread" => Flag::Unread,
                    "removed" => Flag::Removed,
                    _ => return plain(self),
                };
                (Term::Is(flag), lower)
            }
            "has" => {
                if lower == "attachment" {
                    (Term::HasAttachment, lower)
                } else {
                    return plain(self);
                }
            }
            "after" | "before" => {
                let Some(d) = parse_date(value) else {
                    return hint(self, "Invalid date; use YYYY/MM/DD or YYYY-MM-DD");
                };
                let term = if name == "after" {
                    Term::After(d)
                } else {
                    Term::Before(d)
                };
                (term, d.format("%Y-%m-%d").to_string())
            }
            "older_than" | "newer_than" => {
                let Some(a) = parse_age(value) else {
                    return hint(self, "Invalid age; use e.g. 3d, 2m or 1y");
                };
                let term = if name == "older_than" {
                    Term::OlderThan(a)
                } else {
                    Term::NewerThan(a)
                };
                (term, age_label(a))
            }
            _ => {
                // larger / smaller
                let Some(n) = parse_size(value) else {
                    return hint(self, "Invalid size; use bytes or a K, M or G suffix");
                };
                let term = if name == "larger" {
                    Term::Larger(n)
                } else {
                    Term::Smaller(n)
                };
                (term, value.to_uppercase())
            }
        };
        let (start, label) = match minus {
            Some(s) => (s, label_for(self.negated, &name, &shown)),
            None => (t.start, label_for(self.negated, &name, &shown)),
        };
        self.chips.push(Chip {
            start,
            end: t.end,
            label,
        });
        Some(Expr::Term(term))
    }
}

pub fn parse_query(input: &str) -> ParsedQuery {
    let mut p = Parser {
        input,
        toks: tokenize(input),
        pos: 0,
        depth: 0,
        negated: false,
        chips: Vec::new(),
        hints: Vec::new(),
        terms: Vec::new(),
    };
    let mut items = Vec::new();
    while p.pos < p.toks.len() {
        items.extend(p.parse_or());
        // stray closers at top level
        while matches!(p.peek(), Some(Tok::RParen | Tok::RBrace)) {
            p.pos += 1;
        }
    }
    ParsedQuery {
        expr: collapse(items, Expr::And),
        chips: p.chips,
        hints: p.hints,
        terms: p.terms,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }
    fn t(term: Term) -> Expr {
        Expr::Term(term)
    }
    fn text(s: &str) -> Expr {
        t(Term::Text(s.into()))
    }
    fn not(e: Expr) -> Expr {
        Expr::Not(Box::new(e))
    }
    fn single(q: &str) -> Term {
        match parse_query(q).expr {
            Some(Expr::Term(t)) => t,
            other => panic!("{q:?} -> {other:?}"),
        }
    }

    #[test]
    fn combined_operators_with_chip_spans() {
        let q = "from:delta after:2018/01/01 has:attachment";
        let p = parse_query(q);
        assert_eq!(
            p.expr,
            Some(Expr::And(vec![
                t(Term::From("delta".into())),
                t(Term::After(d(2018, 1, 1))),
                t(Term::HasAttachment),
            ]))
        );
        let spans: Vec<_> = p
            .chips
            .iter()
            .map(|c| (&q[c.start..c.end], c.label.as_str()))
            .collect();
        assert_eq!(
            spans,
            [
                ("from:delta", "from: delta"),
                ("after:2018/01/01", "after: 2018-01-01"),
                ("has:attachment", "has: attachment"),
            ]
        );
        assert!(p.terms.is_empty());
    }

    #[test]
    fn operator_table() {
        let cases: Vec<(&str, Term)> = vec![
            ("after:2018-01-01", Term::After(d(2018, 1, 1))),
            ("after:2018/1/5", Term::After(d(2018, 1, 5))),
            ("before:2019/12/31", Term::Before(d(2019, 12, 31))),
            (
                "older_than:2y",
                Term::OlderThan(Age {
                    n: 2,
                    unit: AgeUnit::Year,
                }),
            ),
            (
                "NEWER_THAN:3D",
                Term::NewerThan(Age {
                    n: 3,
                    unit: AgeUnit::Day,
                }),
            ),
            (
                "older_than:2m",
                Term::OlderThan(Age {
                    n: 2,
                    unit: AgeUnit::Month,
                }),
            ),
            ("larger:5M", Term::Larger(5_242_880)),
            ("larger:1000", Term::Larger(1000)),
            ("smaller:200k", Term::Smaller(204_800)),
            ("smaller:1G", Term::Smaller(1 << 30)),
            ("is:removed", Term::Is(Flag::Removed)),
            ("is:Starred", Term::Is(Flag::Starred)),
            ("is:important", Term::Is(Flag::Important)),
            ("is:unread", Term::Is(Flag::Unread)),
            ("in:anywhere", Term::In(Location::Anywhere)),
            ("in:INBOX", Term::In(Location::Inbox)),
            ("in:sent", Term::In(Location::Sent)),
            ("in:spam", Term::In(Location::Spam)),
            ("in:trash", Term::In(Location::Trash)),
            ("category:Promotions", Term::Category("promotions".into())),
            ("filename:pdf", Term::Filename("pdf".into())),
            ("filename:report.pdf", Term::Filename("report.pdf".into())),
            ("FROM:Bob", Term::From("Bob".into())),
            ("to:a@b.com", Term::To("a@b.com".into())),
            ("cc:x", Term::Cc("x".into())),
            ("bcc:x", Term::Bcc("x".into())),
            ("subject:\"big deal\"", Term::Subject("big deal".into())),
            ("label:receipts-2019", Term::Label("receipts-2019".into())),
            (
                "label:\"Receipts 2019\"",
                Term::Label("receipts 2019".into()),
            ),
            ("foo:bar", Term::Text("foo:bar".into())),
            ("in:nowhere", Term::Text("in:nowhere".into())),
            ("is:weird", Term::Text("is:weird".into())),
            ("has:drive", Term::Text("has:drive".into())),
            ("\"exact phrase\"", Term::Phrase("exact phrase".into())),
        ];
        for (q, want) in cases {
            assert_eq!(single(q), want, "{q}");
        }
    }

    #[test]
    fn boolean_structure() {
        let p = |q: &str| parse_query(q).expr;
        assert_eq!(
            p("\"exact phrase\" -word"),
            Some(Expr::And(vec![
                t(Term::Phrase("exact phrase".into())),
                not(text("word"))
            ]))
        );
        assert_eq!(p("a OR b"), Some(Expr::Or(vec![text("a"), text("b")])));
        assert_eq!(p("{a b}"), Some(Expr::Or(vec![text("a"), text("b")])));
        assert_eq!(
            p("(a OR b) c"),
            Some(Expr::And(vec![
                Expr::Or(vec![text("a"), text("b")]),
                text("c")
            ]))
        );
        assert_eq!(
            p("a b OR c d"),
            Some(Expr::Or(vec![
                Expr::And(vec![text("a"), text("b")]),
                Expr::And(vec![text("c"), text("d")])
            ]))
        );
        assert_eq!(
            p("-(a b)"),
            Some(not(Expr::And(vec![text("a"), text("b")])))
        );
        assert_eq!(p("--a"), Some(text("a")));
    }

    #[test]
    fn negated_operator_chip() {
        let q = "x -from:bob";
        let p = parse_query(q);
        assert_eq!(
            p.expr,
            Some(Expr::And(vec![text("x"), not(t(Term::From("bob".into())))]))
        );
        assert_eq!(p.chips.len(), 1);
        assert_eq!(&q[p.chips[0].start..p.chips[0].end], "-from:bob");
        assert_eq!(p.chips[0].label, "not from: bob");
    }

    #[test]
    fn chips_in_negated_groups_and_double_negation() {
        let p = parse_query("-(from:x y)");
        assert_eq!(p.chips[0].label, "not from: x");
        let p = parse_query("-(-from:x)");
        assert_eq!(p.chips[0].label, "from: x");
        assert_eq!(p.chips[0].start, 2);
        let p = parse_query("--from:x");
        assert_eq!(p.chips[0].label, "from: x");
        assert_eq!((p.chips[0].start, p.chips[0].end), (0, 8));
    }

    #[test]
    fn removing_chip_span_leaves_no_stray_minus() {
        let q = "a --from:x b";
        let c = &parse_query(q).chips[0];
        let rest = format!("{}{}", &q[..c.start], &q[c.end..]);
        assert_eq!(rest, "a  b");
    }

    #[test]
    fn blank_phrase_and_quoted_fallback() {
        let p = parse_query("\" \"");
        assert_eq!(p.expr, None);
        assert!(p.terms.is_empty());
        let p = parse_query("foo:\"a b\"");
        assert_eq!(p.terms, ["foo:a b"]);
        let p = parse_query("from:");
        assert_eq!((p.expr, p.chips.len(), p.terms.len()), (None, 0, 0));
    }

    #[test]
    fn quoted_value_chip_span_includes_quotes() {
        let q = "label:\"Receipts 2019\" z";
        let p = parse_query(q);
        assert_eq!(
            &q[p.chips[0].start..p.chips[0].end],
            "label:\"Receipts 2019\""
        );
        assert_eq!(p.chips[0].label, "label: receipts 2019");
    }

    #[test]
    fn invalid_values_give_hints() {
        for q in [
            "after:2018/13/45",
            "before:nope",
            "older_than:5x",
            "larger:abc",
            "smaller:99999999999999999999G",
        ] {
            let p = parse_query(q);
            assert_eq!(p.expr, None, "{q}");
            assert!(p.chips.is_empty());
            assert_eq!(p.hints.len(), 1, "{q}");
            assert_eq!((p.hints[0].start, p.hints[0].end), (0, q.len()));
        }
    }

    #[test]
    fn partial_queries_never_fail() {
        for q in [
            "from:",
            "\"unclosed",
            "(a b",
            "a -",
            "a OR",
            ")",
            "-",
            "\"\"",
            "   ",
            "",
            "OR",
            "{",
            "}a{",
            "- -",
            "-)",
        ] {
            let p = parse_query(q);
            match p.expr {
                None => {}
                Some(e) => {
                    fn plain(e: &Expr) -> bool {
                        match e {
                            Expr::And(v) | Expr::Or(v) => v.iter().all(plain),
                            Expr::Not(e) => plain(e),
                            Expr::Term(t) => matches!(t, Term::Text(_) | Term::Phrase(_)),
                        }
                    }
                    assert!(plain(&e), "{q:?}");
                }
            }
        }
        assert_eq!(
            parse_query("(a b").expr,
            Some(Expr::And(vec![text("a"), text("b")]))
        );
        assert_eq!(parse_query("a OR").expr, Some(text("a")));
        assert_eq!(
            parse_query("\"unclosed x").expr,
            Some(t(Term::Phrase("unclosed x".into())))
        );
    }

    #[test]
    fn terms_for_highlight() {
        let p = parse_query("from:x hello \"big deal\" -nope hello");
        assert_eq!(p.terms, ["hello", "big deal"]);
        assert_eq!(parse_query("-(a b) c").terms, ["c"]);
    }

    #[test]
    fn non_ascii_spans_are_byte_offsets() {
        let q = "é from:José";
        let p = parse_query(q);
        assert_eq!(&q[p.chips[0].start..p.chips[0].end], "from:José");
    }

    #[test]
    fn never_panics_on_truncations() {
        let qs = [
            "from:delta after:2018/01/01 has:attachment -label:\"Receipts 2019\" (a OR b) {c d} \"é phrase\"",
            "-(from:x OR to:ý) larger:5M older_than:2y subject:\"zß\" -\"q\" ((((a))))",
            "日本語 from:日本 \"日本 語\" -{a b} OR OR ))((",
        ];
        for q in qs {
            for (i, _) in q.char_indices().chain([(q.len(), ' ')]) {
                let s = &q[..i];
                let p = parse_query(s);
                for c in &p.chips {
                    assert!(
                        s.is_char_boundary(c.start) && s.is_char_boundary(c.end) && c.start < c.end
                    );
                }
                parse_query(&q[i..]);
            }
        }
        let deep = "(".repeat(100_000) + &"-".repeat(100_000) + "a" + &")".repeat(100_000);
        parse_query(&deep);
        parse_query(&"{".repeat(100_000));
    }
}
