use std::path::Path;

use mangavault_desktop::archive::{list_archive_pages, page_data_url};

#[test]
fn indexes_and_renders_pdf_when_renderer_is_available() {
    let dir = tempfile::tempdir().unwrap();
    let pdf_path = dir.path().join("one-page.pdf");
    write_minimal_pdf(&pdf_path);

    let pages = list_archive_pages(&pdf_path).unwrap();
    assert_eq!(pages.len(), 1);
    assert_eq!(pages[0].path, "pdf-page:1");

    let (mime, data_url) = match page_data_url(&pdf_path, &pages[0].path) {
        Ok(payload) => payload,
        Err(err) if err.to_string().contains("external extractor unavailable") => return,
        Err(err) => panic!("PDF renderer failed: {err}"),
    };
    assert_eq!(mime, "image/png");
    assert!(data_url.starts_with("data:image/png;base64,"));
}

fn write_minimal_pdf(path: &Path) {
    let mut bytes = Vec::new();
    let mut offsets = Vec::new();
    bytes.extend_from_slice(b"%PDF-1.4\n");
    push_object(
        &mut bytes,
        &mut offsets,
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    );
    push_object(
        &mut bytes,
        &mut offsets,
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    );
    push_object(
        &mut bytes,
        &mut offsets,
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Resources << >> /Contents 4 0 R >>\nendobj\n",
    );
    push_object(
        &mut bytes,
        &mut offsets,
        b"4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n",
    );
    let xref_offset = bytes.len();
    bytes.extend_from_slice(format!("xref\n0 {}\n", offsets.len() + 1).as_bytes());
    bytes.extend_from_slice(b"0000000000 65535 f \n");
    for offset in offsets {
        bytes.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    bytes.extend_from_slice(
        format!("trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n").as_bytes(),
    );
    std::fs::write(path, bytes).unwrap();
}

fn push_object(bytes: &mut Vec<u8>, offsets: &mut Vec<usize>, object: &[u8]) {
    offsets.push(bytes.len());
    bytes.extend_from_slice(object);
}
