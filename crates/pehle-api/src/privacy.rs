//! Contact details typed into a public drop room are hidden before anyone sees them. Live sellers
//! say it themselves: "If I show the comments, the numbers show; privacy is gone." Buyers never need
//! to share a phone number or UPI ID in the room: checkout happens in their private chat.

/// The message with phone numbers, UPI IDs and email addresses replaced, or None if it had none.
pub fn mask_contact_details(text: &str) -> Option<String> {
    let masked = mask_handles(&mask_phone_numbers(text));
    (masked != text).then_some(masked)
}

/// Runs of 10 or more digits (spaces, dots and hyphens allowed between them, with an optional
/// leading +) are phone numbers.
fn mask_phone_numbers(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < chars.len() {
        let starts_number = chars[i].is_ascii_digit() || (chars[i] == '+' && chars.get(i + 1).is_some_and(char::is_ascii_digit));
        if !starts_number {
            out.push(chars[i]);
            i += 1;
            continue;
        }
        let mut end = i + usize::from(chars[i] == '+');
        let mut digits = 0;
        let mut last_digit = end;
        while end < chars.len() {
            if chars[end].is_ascii_digit() {
                digits += 1;
                last_digit = end;
            } else if !matches!(chars[end], ' ' | '-' | '.') || !chars.get(end + 1).is_some_and(char::is_ascii_digit) {
                break;
            }
            end += 1;
        }
        if digits >= 10 {
            out.push_str("[number hidden]");
            i = last_digit + 1;
        } else {
            out.extend(&chars[i..=last_digit]);
            i = last_digit + 1;
        }
    }
    out
}

/// Words shaped like `name@bank` (UPI) or `name@mail.com` (email).
fn mask_handles(text: &str) -> String {
    text.split_inclusive(char::is_whitespace)
        .map(|word| {
            let trimmed = word.trim_end();
            let core = trimmed.trim_matches(|c: char| matches!(c, ',' | '!' | '?' | ')' | '(' | '"' | '\''));
            match core.split_once('@') {
                Some((name, domain))
                    if name.len() >= 2
                        && domain.len() >= 2
                        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
                        && domain.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-'))
                        && domain.chars().next().is_some_and(|c| c.is_ascii_alphabetic()) =>
                {
                    let label = if domain.trim_end_matches('.').contains('.') { "[email hidden]" } else { "[UPI ID hidden]" };
                    word.replacen(core, label, 1)
                }
                _ => word.to_string(),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hides_indian_phone_numbers_in_any_common_format() {
        for text in ["call me 9810012345", "+91 98100 12345 pe whatsapp", "098100-12345", "my no. 98.100.123.45"] {
            let masked = mask_contact_details(text).unwrap();
            assert!(masked.contains("[number hidden]"), "{text} -> {masked}");
            assert!(masked.chars().filter(char::is_ascii_digit).count() < 10, "{masked}");
        }
    }

    #[test]
    fn hides_upi_ids_and_emails() {
        assert_eq!(mask_contact_details("pay asha.v@okaxis please").unwrap(), "pay [UPI ID hidden] please");
        assert_eq!(mask_contact_details("mail me: asha@gmail.com!").unwrap(), "mail me: [email hidden]!");
    }

    #[test]
    fn leaves_ordinary_chat_alone() {
        for text in ["mine", "S12 chahiye", "price 4500?", "size 38, 2 pieces", "@Meera kab ship hoga", "₹1,25,000 is a lot"] {
            assert_eq!(mask_contact_details(text), None, "{text}");
        }
    }
}
