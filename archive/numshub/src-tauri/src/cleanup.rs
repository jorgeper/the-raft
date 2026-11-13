//! Deterministic transcript cleanup — the always-on layer of the SPEC §4 pipeline.
//!
//! `clean()` is a pure function: (transcript, options) -> cleaned transcript.
//! It strips filler words, bracketed non-speech artifacts, optionally collapses
//! immediately-repeated words, and normalizes whitespace/punctuation damage
//! caused by the removals.

use once_cell::sync::Lazy;
use regex::Regex;

/// Default filler-word list (SPEC §4.1). User-editable via settings.
pub const DEFAULT_FILLERS: &[&str] = &[
    "uh", "um", "uhm", "umm", "uhh", "hmm", "hm", "mm", "mmm", "mhm", "er", "erm", "ah", "eh",
];

/// Non-speech artifact content emitted by STT models inside [] or ().
static ARTIFACT_CONTENT: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)^\s*(music|laugh(s|ter|ing)?|cough(s|ing)?|applause|noise|silence|blank\s*audio|inaudible|unintelligible|sigh(s|ing)?|breath(s|ing)?|clears?\s+throat|clicks?|beep(s|ing)?|static|typing|pause|crosstalk|speaking\s+in\s+foreign\s+language|foreign\s+language|\s*)\s*$",
    )
    .unwrap()
});

static BRACKET_SPAN: Lazy<Regex> = Lazy::new(|| Regex::new(r"\[([^\[\]]*)\]|\(([^()]*)\)").unwrap());

#[derive(Debug, Clone)]
pub struct CleanOptions {
    /// Lowercase filler words to strip (whole-word, case-insensitive match).
    pub fillers: Vec<String>,
    /// Collapse immediately-repeated words ("the the" -> "the").
    pub collapse_repeats: bool,
}

impl Default for CleanOptions {
    fn default() -> Self {
        Self {
            fillers: DEFAULT_FILLERS.iter().map(|s| s.to_string()).collect(),
            collapse_repeats: true,
        }
    }
}

/// A token split into leading punctuation, core word, and trailing punctuation.
struct Token {
    lead: String,
    core: String,
    trail: String,
}

impl Token {
    fn parse(raw: &str) -> Self {
        let start = raw
            .char_indices()
            .find(|(_, c)| c.is_alphanumeric())
            .map(|(i, _)| i);
        let end = raw
            .char_indices()
            .rev()
            .find(|(_, c)| c.is_alphanumeric())
            .map(|(i, c)| i + c.len_utf8());
        match (start, end) {
            (Some(s), Some(e)) => Self {
                lead: raw[..s].to_string(),
                core: raw[s..e].to_string(),
                trail: raw[e..].to_string(),
            },
            _ => Self {
                lead: raw.to_string(),
                core: String::new(),
                trail: String::new(),
            },
        }
    }

    fn render(&self) -> String {
        format!("{}{}{}", self.lead, self.core, self.trail)
    }

    fn ends_sentence(&self) -> bool {
        self.trail.contains(['.', '!', '?'])
    }
}

fn capitalize_first(word: &str) -> String {
    let mut chars = word.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

/// Strip bracketed non-speech artifacts like `[music]`, `(coughs)`, `[BLANK_AUDIO]`.
fn strip_artifacts(text: &str) -> String {
    BRACKET_SPAN
        .replace_all(text, |caps: &regex::Captures| {
            let content = caps
                .get(1)
                .or_else(|| caps.get(2))
                .map(|m| m.as_str())
                .unwrap_or("");
            // Normalize underscores so BLANK_AUDIO-style tags match word patterns.
            let normalized = content.replace('_', " ");
            if ARTIFACT_CONTENT.is_match(&normalized) {
                String::new()
            } else {
                caps.get(0).unwrap().as_str().to_string()
            }
        })
        .into_owned()
}

pub fn clean(text: &str, opts: &CleanOptions) -> String {
    let text = strip_artifacts(text);
    let fillers: Vec<String> = opts.fillers.iter().map(|f| f.to_lowercase()).collect();

    let mut out: Vec<Token> = Vec::new();
    // True when the next kept word begins a sentence (start of text or after .!?).
    let mut at_sentence_start = true;
    // Casing is preserved EXCEPT when a removed filler opened a sentence — then
    // the next kept word is capitalized so the sentence still starts properly.
    let mut capitalize_next = false;
    // Set when a removed filler carried terminal punctuation that must survive.
    let mut pending_terminal: Option<char> = None;

    for raw in text.split_whitespace() {
        let mut tok = Token::parse(raw);
        if tok.core.is_empty() {
            // Pure punctuation fragment (e.g. stranded "...") — keep it attached
            // to the previous token if any, else drop.
            if let Some(prev) = out.last_mut() {
                prev.trail.push_str(&tok.lead);
            }
            continue;
        }

        let core_lower = tok.core.to_lowercase();

        if fillers.iter().any(|f| *f == core_lower) {
            // Removed filler: keep sentence state, propagate terminal punctuation.
            if at_sentence_start {
                capitalize_next = true;
            }
            if let Some(c) = tok.trail.chars().find(|c| ['.', '!', '?'].contains(c)) {
                if let Some(prev) = out.last_mut() {
                    if !prev.ends_sentence() {
                        // Replace a trailing comma with the terminal punct if present.
                        if prev.trail.starts_with(',') {
                            prev.trail = prev.trail.replacen(',', &c.to_string(), 1);
                        } else {
                            prev.trail.push(c);
                        }
                    }
                    at_sentence_start = true;
                } else {
                    pending_terminal = None; // terminal punct with nothing before it: drop
                }
            }
            continue;
        }

        if let Some(c) = pending_terminal.take() {
            tok.lead = format!("{}{}", c, tok.lead);
        }

        // Repeated-word collapse: previous kept token has the same core
        // (case-insensitive on this, the second, occurrence) and no trailing
        // punctuation separating them.
        if opts.collapse_repeats {
            if let Some(prev) = out.last_mut() {
                if !prev.core.is_empty()
                    && prev.trail.is_empty()
                    && tok.lead.is_empty()
                    && prev.core.to_lowercase() == core_lower
                {
                    // Keep the first occurrence; adopt the second's trailing punct.
                    prev.trail = tok.trail.clone();
                    at_sentence_start = prev.ends_sentence();
                    continue;
                }
            }
        }

        if capitalize_next {
            tok.core = capitalize_first(&tok.core);
            capitalize_next = false;
        }
        at_sentence_start = tok.ends_sentence();
        out.push(tok);
    }

    out.iter()
        .map(Token::render)
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(text: &str) -> String {
        clean(text, &CleanOptions::default())
    }

    // R1: filler removal — default list, word boundaries, capitalization repair,
    // filler+comma repair.
    #[test]
    fn r1_strips_default_fillers_whole_word() {
        assert_eq!(c("I was um thinking"), "I was thinking");
        assert_eq!(c("uh let's go"), "Let's go");
        // Mid-sentence filler removal never touches casing.
        assert_eq!(c("so hmm what now"), "so what now");
    }

    #[test]
    fn r1_word_boundaries_protect_real_words() {
        assert_eq!(c("my umbrella is here"), "my umbrella is here");
        assert_eq!(c("summer is warm"), "summer is warm");
        assert_eq!(c("the era of ahoy"), "the era of ahoy");
    }

    #[test]
    fn r1_leading_filler_capitalization_repair() {
        assert_eq!(c("um, hello there"), "Hello there");
        assert_eq!(c("Great. um, next point"), "Great. Next point");
    }

    #[test]
    fn r1_filler_comma_repair() {
        assert_eq!(c("I was, um, thinking"), "I was, thinking");
        assert_eq!(c("yes, uh, I agree"), "yes, I agree");
        // Filler carrying the sentence's terminal punctuation.
        assert_eq!(c("stop it, um."), "stop it.");
    }

    #[test]
    fn r1_custom_filler_list() {
        let opts = CleanOptions {
            fillers: vec!["like".into()],
            collapse_repeats: true,
        };
        assert_eq!(clean("it was like huge", &opts), "it was huge");
        // Default fillers no longer stripped with a custom list.
        assert_eq!(clean("um hello", &opts), "um hello");
    }

    // R2: bracketed artifact stripping.
    #[test]
    fn r2_strips_known_artifacts() {
        // Artifacts are stripped in a pre-pass and never affect casing.
        assert_eq!(c("hello [music] world"), "hello world");
        assert_eq!(c("(coughs) as I said"), "as I said");
        assert_eq!(c("[BLANK_AUDIO]"), "");
        assert_eq!(c("done [applause] now (laughter) ok"), "done now ok");
    }

    #[test]
    fn r2_keeps_real_parenthetical_content() {
        assert_eq!(
            c("the result (see appendix) is fine"),
            "the result (see appendix) is fine"
        );
        assert_eq!(c("array[index] notation"), "array[index] notation");
    }

    // R3: repeated-word collapse.
    #[test]
    fn r3_collapses_immediate_repeats() {
        assert_eq!(c("the the store"), "the store");
        assert_eq!(c("The the store"), "The store");
        assert_eq!(c("go go go"), "go");
    }

    #[test]
    fn r3_preserved_when_setting_off() {
        let opts = CleanOptions {
            collapse_repeats: false,
            ..Default::default()
        };
        assert_eq!(clean("he had had enough", &opts), "he had had enough");
    }

    #[test]
    fn r3_no_collapse_across_sentence_punctuation() {
        assert_eq!(c("I know. Know what?"), "I know. Know what?");
    }

    // R4: edge cases.
    #[test]
    fn r4_empty_and_all_filler() {
        assert_eq!(c(""), "");
        assert_eq!(c("   "), "");
        assert_eq!(c("um uh umm hmm"), "");
        assert_eq!(c("um, uh."), "");
    }

    #[test]
    fn r4_whitespace_collapse() {
        assert_eq!(c("hello    world\n\nagain"), "hello world again");
        assert_eq!(c("  padded  "), "padded");
    }

    #[test]
    fn r4_punctuation_stranding_repaired() {
        // Stranded ellipsis fragment after a removed filler attaches to prior word.
        assert_eq!(c("well um ... fine"), "well... fine");
        // Artifact removal never leaves doubled spaces.
        assert_eq!(c("a [music]  b"), "a b");
    }

    #[test]
    fn r4_unicode_safe() {
        assert_eq!(c("café um münchen"), "café münchen");
        assert_eq!(c("um über alles"), "Über alles");
    }
}
