//! "I am X" self-identification matcher (spec §5.2). Pure text rules — no LLM.

/// Words that follow "I am / I'm / this is" without being names.
const STOPLIST: &[&str] = &[
    "sure", "sorry", "done", "here", "late", "ready", "recording", "going", "just", "not",
    "so", "very", "only", "still", "always", "never", "afraid", "glad", "happy", "sad",
    "tired", "busy", "back", "off", "out", "in", "on", "good", "fine", "okay", "ok", "sick",
    "serious", "certain", "positive", "confident", "aware", "available", "important", "a",
    "an", "the", "all", "also", "almost", "about", "at", "now", "really", "quite", "pretty",
    "too", "already", "again", "currently", "definitely", "absolutely", "totally", "kind",
    "sort", "thinking", "trying", "saying", "asking", "wondering", "curious", "excited",
    "worried", "concerned", "speaking", "talking", "listening",
    // Capitalized non-names that commonly follow the trigger phrases.
    "everything", "everyone", "everybody", "nothing", "something", "someone", "somebody",
    "monday", "tuesday", "tuesday's", "wednesday", "wednesday's", "thursday", "thursday's",
    "friday", "friday's", "saturday", "sunday", "monday's", "saturday's", "sunday's",
    "january", "february", "march", "april", "may", "june", "july", "august", "september",
    "october", "november", "december", "today", "tomorrow", "yesterday",
];

/// Detects a self-introduction in a finalized utterance; returns the name.
///
/// Patterns: "I am X", "I'm X", "my name is X", "this is X [speaking]" where
/// X is 1–2 capitalized tokens. "this is" additionally requires a short
/// utterance (< 8 words) since it so often introduces things, not people.
pub fn detect_self_name(text: &str) -> Option<String> {
    let words: Vec<&str> = text.split_whitespace().collect();
    let lower: Vec<String> = words.iter().map(|w| w.to_lowercase()).collect();
    let strip = |w: &str| w.trim_matches(|c: char| !c.is_alphanumeric() && c != '-').to_string();

    // Find the index right after a trigger phrase.
    let mut candidates: Vec<usize> = Vec::new();
    for i in 0..lower.len() {
        let l = |k: usize| lower.get(k).map(|s| strip(s)).unwrap_or_default();
        if l(i) == "i" && l(i + 1) == "am" {
            candidates.push(i + 2);
        } else if l(i) == "i'm" {
            candidates.push(i + 1);
        } else if l(i) == "my" && l(i + 1) == "name" && l(i + 2) == "is" {
            candidates.push(i + 3);
        } else if l(i) == "this" && l(i + 1) == "is" && words.len() < 8 {
            candidates.push(i + 2);
        }
    }

    for start in candidates {
        if let Some(name) = name_at(&words, start) {
            return Some(name);
        }
    }
    None
}

/// A name is 1–2 consecutive capitalized alphabetic tokens at `start`,
/// none of which are stoplisted.
fn name_at(words: &[&str], start: usize) -> Option<String> {
    let clean = |w: &str| {
        w.trim_matches(|c: char| !c.is_alphabetic() && c != '-' && c != '\'').to_string()
    };
    let is_name_token = |w: &str| {
        let t = clean(w);
        !t.is_empty()
            && t.chars().next().unwrap().is_uppercase()
            && t.chars().all(|c| c.is_alphabetic() || c == '-' || c == '\'')
            && !STOPLIST.contains(&t.to_lowercase().as_str())
    };

    let first = words.get(start)?;
    if !is_name_token(first) {
        return None;
    }
    // A trailing comma/period ends the name ("I am Alice and..." vs "I am Alice.").
    let first_terminated = first.ends_with(|c: char| !c.is_alphanumeric() && c != '\'');
    let mut name = clean(first);
    if !first_terminated {
        if let Some(second) = words.get(start + 1) {
            let second_lower = clean(second).to_lowercase();
            // "speaking" after "this is Bob speaking" is part of the phrase, not the name.
            if is_name_token(second) && second_lower != "speaking" {
                name.push(' ');
                name.push_str(&clean(second));
            }
        }
    }
    Some(name)
}

#[cfg(test)]
mod tests {
    use super::detect_self_name;

    #[test]
    fn positives() {
        let cases = [
            ("I am Jorge", "Jorge"),
            ("i'm Alice.", "Alice"),
            ("My name is Mary Jane", "Mary Jane"),
            ("This is Bob speaking", "Bob"),
            ("Hi everyone, I am Jorge and I'll take notes", "Jorge"),
            ("Well, I am Alice and I say we ship it anyway.", "Alice"),
            ("By the way, my name is Kate.", "Kate"),
        ];
        for (input, expected) in cases {
            assert_eq!(
                detect_self_name(input).as_deref(),
                Some(expected),
                "input: {input}"
            );
        }
    }

    #[test]
    fn negatives() {
        let cases = [
            "I am sure this works",
            "I am not going",
            "I am so late",
            "I'm okay with that",
            "My name is not important",
            "this is a very long sentence that happens to say this is Something else entirely",
            "I am recording this meeting",
            "This is Everything we hoped for and more so let's celebrate",
            "i am very confident",
            "This is Tuesday's agenda item number four",
        ];
        for input in cases {
            assert_eq!(detect_self_name(input), None, "input: {input}");
        }
    }

    #[test]
    fn two_token_cap() {
        assert_eq!(
            detect_self_name("I am Jorge Alberto Perez").as_deref(),
            Some("Jorge Alberto")
        );
    }

    #[test]
    fn punctuation_ends_name() {
        assert_eq!(detect_self_name("I am Alice, nice to meet you all").as_deref(), Some("Alice"));
    }
}
