//! Reads a live-chat message and decides whether it claims an item.
//!
//! Buyers on Indian live sales write "mine", "S12", "ye wala", "mujhe chahiye", "मुझे चाहिए" and so on.
//! This must run inside the five-second pre-messaging window, so it is a fast deterministic matcher,
//! not a model call. Anything ambiguous is treated as ordinary chat: a missed claim can be retried
//! with the Claim button, but a false claim would take an item from someone.

#[derive(Debug, PartialEq, Eq)]
pub enum Intent {
    /// A claim on the item with this code, or on the pinned item when `None`.
    Claim { code: Option<String> },
    /// A question the co-host may answer.
    Question,
    Chatter,
}

const CLAIM_PHRASES: &[&str] = &[
    "mine", "dibs", "claim", "claimed", "i'll take", "ill take", "i will take", "i'll take it", "i want this",
    "i want it", "want this", "book", "book it", "booked", "book kar", "book karo", "book kardo", "book kar do",
    "mera", "meri", "mere", "mujhe", "mujhe chahiye", "chahiye", "lena hai", "le lunga", "le lungi", "lunga",
    "lungi", "ye wala", "yeh wala", "ye wali", "yeh wali", "ye mera", "sold to me", "done for me",
    "मेरा", "मेरी", "मुझे", "चाहिए", "ले लूंगी", "ले लूंगा", "लूंगी", "लूंगा", "बुक", "ये वाला", "ये वाली",
];

const NEGATIONS: &[&str] = &[
    "not", "no", "nahi", "nahin", "nai", "mat", "dont", "don't", "never", "cancel", "नहीं", "मत",
];

const QUESTION_STARTS: &[&str] = &[
    "what", "how", "when", "where", "which", "is", "are", "can", "do", "does", "will", "price", "rate", "kitna",
    "kitne", "kitni", "kya", "kaise", "kab", "kaha", "kahan", "size", "cod", "shipping", "delivery", "available",
    "colour", "color", "fabric", "return", "क्या", "कितना", "कितने", "कैसे", "कब",
];

/// Claims are short. A long message that happens to contain "mine" is not a claim.
const MAX_CLAIM_CHARS: usize = 60;

fn normalise(text: &str) -> String {
    let lowered = text.to_lowercase();
    let cleaned: String = lowered
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '\'' || c == '?' || c.is_whitespace() || is_devanagari_mark(c) { c } else { ' ' })
        .collect();
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn is_devanagari_mark(c: char) -> bool {
    ('\u{0900}'..='\u{097F}').contains(&c)
}

fn contains_phrase(haystack: &str, phrase: &str) -> bool {
    // Whole-word match on the normalised text.
    let padded = format!(" {haystack} ");
    padded.contains(&format!(" {phrase} "))
}

/// Find an item code in the message. Codes are matched against the items open in the room, so
/// "S12", "s12" and "s 12" all match `S12`, while "2 pieces" does not match `2` unless it is open.
fn find_code(normalised: &str, open_codes: &[String]) -> Option<String> {
    let compact: Vec<String> = normalised.split(' ').map(|t| t.to_uppercase()).collect();
    for code in open_codes {
        let code_upper = code.to_uppercase();
        if compact.contains(&code_upper) {
            return Some(code_upper);
        }
        // "s 12" -> "S12"
        if compact.windows(2).any(|w| format!("{}{}", w[0], w[1]) == code_upper) {
            return Some(code_upper);
        }
    }
    None
}

pub fn classify(text: &str, open_codes: &[String]) -> Intent {
    let normalised = normalise(text);
    if normalised.is_empty() {
        return Intent::Chatter;
    }
    let negated = NEGATIONS.iter().any(|n| contains_phrase(&normalised, n));
    let code = find_code(&normalised, open_codes);
    let words = normalised.split(' ').count();
    let is_question = normalised.ends_with('?')
        || QUESTION_STARTS.iter().any(|q| normalised.starts_with(&format!("{q} ")) || normalised == *q);

    if !negated && !is_question && text.chars().count() <= MAX_CLAIM_CHARS {
        let has_phrase = CLAIM_PHRASES.iter().any(|p| contains_phrase(&normalised, p));
        // A bare code ("S12", "s12 pls") is how many buyers claim.
        let bare_code = code.is_some() && words <= 3;
        if has_phrase || bare_code {
            return Intent::Claim { code };
        }
    }
    if is_question {
        return Intent::Question;
    }
    Intent::Chatter
}

#[cfg(test)]
mod tests {
    use super::*;

    fn codes() -> Vec<String> {
        vec!["S12".into(), "K7".into(), "B101".into()]
    }

    fn claim(code: Option<&str>) -> Intent {
        Intent::Claim { code: code.map(str::to_string) }
    }

    #[test]
    fn english_and_hinglish_claims() {
        for text in ["mine", "Mine!!", "MINE 🙋‍♀️", "dibs", "I'll take it", "book it", "mera", "ye wala", "mujhe chahiye",
            "le lungi", "yeh wali please", "book kar do"] {
            assert_eq!(classify(text, &codes()), claim(None), "{text}");
        }
    }

    #[test]
    fn devanagari_claims() {
        for text in ["मेरा", "मुझे चाहिए", "ये वाली", "बुक"] {
            assert_eq!(classify(text, &codes()), claim(None), "{text}");
        }
    }

    #[test]
    fn codes_pick_the_item() {
        assert_eq!(classify("S12", &codes()), claim(Some("S12")));
        assert_eq!(classify("s12 mine", &codes()), claim(Some("S12")));
        assert_eq!(classify("mine k7", &codes()), claim(Some("K7")));
        assert_eq!(classify("s 12 pls", &codes()), claim(Some("S12")));
        assert_eq!(classify("B101 mera", &codes()), claim(Some("B101")));
    }

    #[test]
    fn questions_and_negations_are_not_claims() {
        assert_eq!(classify("is S12 available?", &codes()), Intent::Question);
        assert_eq!(classify("kitna hai ye?", &codes()), Intent::Question);
        assert_eq!(classify("price of k7", &codes()), Intent::Question);
        assert_eq!(classify("not mine", &codes()), Intent::Chatter);
        assert_eq!(classify("mujhe nahi chahiye", &codes()), Intent::Chatter);
        assert_eq!(classify("cancel mine", &codes()), Intent::Chatter);
    }

    #[test]
    fn ordinary_chat_stays_chat() {
        assert_eq!(classify("beautiful colour di", &codes()), Intent::Chatter);
        assert_eq!(classify("hello from Pune", &codes()), Intent::Chatter);
        assert_eq!(classify("", &codes()), Intent::Chatter);
        assert_eq!(
            classify("my mother has one just like this from her wedding, it is still mine somewhere at home", &codes()),
            Intent::Chatter
        );
        // An unknown code is not a claim.
        assert_eq!(classify("Z99", &codes()), Intent::Chatter);
    }
}
