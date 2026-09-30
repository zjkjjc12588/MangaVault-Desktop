use quick_xml::{events::Event, Reader};

use crate::{
    error::{MangaVaultError, Result},
    extensions::ComicInfo,
};

pub fn parse_comic_info_xml(xml: &str) -> Result<ComicInfo> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut current = None::<String>;
    let mut info = ComicInfo {
        title: None,
        series: None,
        number: None,
        volume: None,
        writer: None,
        language_iso: None,
        year: None,
        tags: Vec::new(),
    };
    loop {
        match reader.read_event() {
            Ok(Event::Start(element)) => {
                current = Some(String::from_utf8_lossy(element.name().as_ref()).to_string());
            }
            Ok(Event::Text(text)) => {
                if let Some(field) = current.as_deref() {
                    let value = text
                        .unescape()
                        .map_err(|err| MangaVaultError::Message(err.to_string()))?
                        .trim()
                        .to_string();
                    apply_comic_info_field(&mut info, field, &value);
                }
            }
            Ok(Event::End(_)) => {
                current = None;
            }
            Ok(Event::Eof) => break,
            Err(err) => return Err(MangaVaultError::Message(err.to_string())),
            _ => {}
        }
    }
    Ok(info)
}

pub fn export_comic_info_xml(info: &ComicInfo) -> String {
    let mut xml = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<ComicInfo>\n");
    push_optional(&mut xml, "Title", info.title.as_deref());
    push_optional(&mut xml, "Series", info.series.as_deref());
    push_optional(&mut xml, "Number", info.number.as_deref());
    if let Some(volume) = info.volume {
        push_optional(&mut xml, "Volume", Some(&volume.to_string()));
    }
    push_optional(&mut xml, "Writer", info.writer.as_deref());
    push_optional(&mut xml, "LanguageISO", info.language_iso.as_deref());
    if let Some(year) = info.year {
        push_optional(&mut xml, "Year", Some(&year.to_string()));
    }
    if !info.tags.is_empty() {
        push_optional(&mut xml, "Tags", Some(&info.tags.join(", ")));
    }
    xml.push_str("</ComicInfo>\n");
    xml
}

fn apply_comic_info_field(info: &mut ComicInfo, field: &str, value: &str) {
    if value.is_empty() {
        return;
    }
    match field {
        "Title" => info.title = Some(value.to_string()),
        "Series" => info.series = Some(value.to_string()),
        "Number" => info.number = Some(value.to_string()),
        "Volume" => info.volume = value.parse::<i64>().ok(),
        "Writer" => info.writer = Some(value.to_string()),
        "LanguageISO" => info.language_iso = Some(value.to_string()),
        "Year" => info.year = value.parse::<i64>().ok(),
        "Tags" | "Genre" => {
            info.tags = value
                .split(',')
                .map(str::trim)
                .filter(|tag| !tag.is_empty())
                .map(ToString::to_string)
                .collect();
        }
        _ => {}
    }
}

fn push_optional(xml: &mut String, tag: &str, value: Option<&str>) {
    if let Some(value) = value.filter(|value| !value.is_empty()) {
        xml.push_str("  <");
        xml.push_str(tag);
        xml.push('>');
        xml.push_str(&escape_xml(value));
        xml.push_str("</");
        xml.push_str(tag);
        xml.push_str(">\n");
    }
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_comic_info_xml_fields() {
        let info = parse_comic_info_xml(
            r#"<?xml version="1.0"?>
            <ComicInfo>
              <Title>Chapter 1</Title>
              <Series>Signal &amp; Noise</Series>
              <Number>1</Number>
              <Volume>2</Volume>
              <Writer>Ada</Writer>
              <LanguageISO>en</LanguageISO>
              <Year>2026</Year>
              <Tags>Cyberpunk, Mystery</Tags>
            </ComicInfo>"#,
        )
        .unwrap();

        assert_eq!(info.title.as_deref(), Some("Chapter 1"));
        assert_eq!(info.series.as_deref(), Some("Signal & Noise"));
        assert_eq!(info.volume, Some(2));
        assert_eq!(info.tags, vec!["Cyberpunk", "Mystery"]);
    }

    #[test]
    fn exports_and_reparses_comic_info_xml() {
        let original = ComicInfo {
            title: Some("A < B".to_string()),
            series: Some("Vault".to_string()),
            number: Some("3".to_string()),
            volume: Some(1),
            writer: Some("MangaVault Lab".to_string()),
            language_iso: Some("en".to_string()),
            year: Some(2026),
            tags: vec!["Action".to_string(), "Drama".to_string()],
        };

        let xml = export_comic_info_xml(&original);
        let parsed = parse_comic_info_xml(&xml).unwrap();

        assert_eq!(parsed, original);
    }
}
