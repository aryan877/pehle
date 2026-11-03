//! Pehle's Nexconn IDs. Nexconn accepts only letters and digits (up to 64), so each ID is a
//! one-letter prefix plus the 32 hex digits of a UUID. Open channels are `live` plus a drop slug.

/// Who a Nexconn user ID belongs to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// `t…`: a shop team member.
    Staff,
    /// `u…`: a signed-in buyer.
    Buyer,
    /// `h…`: a shop's AI co-host.
    Cohost,
    /// `v…`: a signed-out viewer, who can watch but not send.
    Viewer,
}

fn is_hex_body(id: &str) -> bool {
    id.len() == 33 && id[1..].bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub fn kind(user_id: &str) -> Option<Kind> {
    if !is_hex_body(user_id) {
        return None;
    }
    match user_id.as_bytes()[0] {
        b't' => Some(Kind::Staff),
        b'u' => Some(Kind::Buyer),
        b'h' => Some(Kind::Cohost),
        b'v' => Some(Kind::Viewer),
        _ => None,
    }
}

/// `c…`: a buyer↔shop conversation group.
pub fn is_conversation(channel_id: &str) -> bool {
    channel_id.starts_with('c') && is_hex_body(channel_id)
}

/// True when an ID uses only what Nexconn accepts.
pub fn is_valid(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefixes_identify_people_and_reject_anything_else() {
        let hex = "0123456789abcdef0123456789abcdef";
        assert_eq!(kind(&format!("u{hex}")), Some(Kind::Buyer));
        assert_eq!(kind(&format!("t{hex}")), Some(Kind::Staff));
        assert_eq!(kind(&format!("h{hex}")), Some(Kind::Cohost));
        assert_eq!(kind(&format!("v{hex}")), Some(Kind::Viewer));
        assert_eq!(kind(&format!("x{hex}")), None);
        assert_eq!(kind("u123"), None);
        assert_eq!(kind(&format!("u{}", hex.to_uppercase())), None);
        assert!(is_conversation(&format!("c{hex}")));
        assert!(!is_conversation(&format!("g{hex}")));
        assert!(is_valid(&format!("live{}", "ab12cd34")));
        assert!(!is_valid("b_1"));
    }
}
