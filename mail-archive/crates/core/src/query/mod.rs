//! Gmail-style search query language: parsing into an AST (and later execution).

pub mod parse;

pub use parse::{Age, AgeUnit, Chip, Expr, Flag, Hint, Location, ParsedQuery, Term, parse_query};
