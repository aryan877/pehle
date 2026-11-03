//! Rupee formatting and UPI payment links.

/// `450000` paise -> `₹4,500`; `12345678` -> `₹1,23,456.78`. Indian digit grouping.
pub fn format_inr(paise: i64) -> String {
    let negative = paise < 0;
    let paise = paise.unsigned_abs();
    let rupees = paise / 100;
    let fraction = paise % 100;
    let digits = rupees.to_string();
    let grouped = if digits.len() <= 3 {
        digits
    } else {
        let (head, last3) = digits.split_at(digits.len() - 3);
        let mut parts: Vec<&str> = Vec::new();
        let mut rest = head;
        while rest.len() > 2 {
            let (a, b) = rest.split_at(rest.len() - 2);
            parts.push(b);
            rest = a;
        }
        if !rest.is_empty() {
            parts.push(rest);
        }
        parts.reverse();
        format!("{},{last3}", parts.join(","))
    };
    let sign = if negative { "-" } else { "" };
    if fraction == 0 { format!("{sign}₹{grouped}") } else { format!("{sign}₹{grouped}.{fraction:02}") }
}

/// A `upi://pay` intent link that opens any UPI app with the amount and note filled in.
pub fn upi_link(vpa: &str, payee_name: &str, amount_paise: i64, note: &str, reference: &str) -> String {
    let amount = format!("{}.{:02}", amount_paise / 100, amount_paise % 100);
    let mut url = url::Url::parse("upi://pay").expect("static URL");
    url.query_pairs_mut()
        .append_pair("pa", vpa)
        .append_pair("pn", payee_name)
        .append_pair("am", &amount)
        .append_pair("cu", "INR")
        .append_pair("tn", &note.chars().take(50).collect::<String>())
        .append_pair("tr", reference);
    url.to_string()
}

/// Short, speakable order reference: `PEHLE-3F9A2C`.
pub fn order_reference(order_id: uuid::Uuid) -> String {
    format!("PEHLE-{}", &order_id.simple().to_string()[..6].to_uppercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn indian_grouping() {
        assert_eq!(format_inr(100), "₹1");
        assert_eq!(format_inr(99_900), "₹999");
        assert_eq!(format_inr(450_000), "₹4,500");
        assert_eq!(format_inr(12_345_678), "₹1,23,456.78");
        assert_eq!(format_inr(1_000_000_000), "₹1,00,00,000");
    }

    #[test]
    fn upi_link_is_encoded() {
        let link = upi_link("meera@okaxis", "Meera Sarees", 450_000, "S12 Kanjivaram silk", "PEHLE-3F9A2C");
        assert!(link.starts_with("upi://pay?pa=meera%40okaxis&pn=Meera+Sarees&am=4500.00&cu=INR"));
        assert!(link.ends_with("&tr=PEHLE-3F9A2C"));
    }
}
