use mangavault_desktop::scanner::parse_title;

#[test]
fn scanner_extracts_common_metadata() {
    let parsed = parse_title("[Jane Doe] Midnight Library Vol. 3 Ch. 12");
    assert_eq!(parsed.author.as_deref(), Some("Jane Doe"));
    assert_eq!(parsed.title, "[Jane Doe] Midnight Library Vol. 3 Ch. 12");
    assert_eq!(parsed.volume, Some(3.0));
    assert_eq!(parsed.chapter, Some(12.0));
}
