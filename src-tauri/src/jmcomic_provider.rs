use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use aes::cipher::{BlockDecryptMut, KeyInit};
use aes::Aes256;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use md5::{Digest, Md5};
use reqwest::redirect::Policy;
use reqwest::{Client, Url};
use serde_json::Value;
use tokio::sync::{Mutex, OnceCell, Semaphore};

use crate::error::{MangaVaultError, Result};
use crate::models::ExternalChapterMetadata;

const API_TOKEN_SECRET: &str = "18comicAPP";
const API_DATA_SECRET: &str = "185Hcomic3PAPP7R";
const API_HEADER_VERSION: &str = "2.0.26";
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const ALLOWED_API_HOSTS: &[&str] = &["www.cdngwc.cc", "www.cdnhjk.net"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JmComicRemoteMetadata {
    pub remote_id: String,
    pub original_title: Option<String>,
    pub authors: Vec<String>,
    pub categories: Vec<String>,
    pub tags: Vec<String>,
    pub description: Option<String>,
    pub chapters: Vec<ExternalChapterMetadata>,
    pub remote_cover_url: Option<String>,
    pub payload_hash: String,
}

pub struct JmComicProviderState {
    client: Client,
    requests: Mutex<HashMap<String, Arc<OnceCell<JmComicRemoteMetadata>>>>,
    last_request: Mutex<Option<Instant>>,
    semaphore: Semaphore,
}

impl JmComicProviderState {
    pub fn new() -> Result<Self> {
        let client = Client::builder()
            .https_only(true)
            .redirect(Policy::none())
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(15))
            .user_agent("MangaVault-Desktop/1.1 JMComic-metadata")
            .build()
            .map_err(|error| MangaVaultError::Message(error.to_string()))?;
        Ok(Self {
            client,
            requests: Mutex::new(HashMap::new()),
            last_request: Mutex::new(None),
            semaphore: Semaphore::new(2),
        })
    }

    pub async fn fetch(
        &self,
        remote_id: &str,
        endpoint: &str,
        request_interval: Duration,
    ) -> Result<JmComicRemoteMetadata> {
        validate_remote_id(remote_id)?;
        let endpoint = validated_endpoint(endpoint)?;
        let key = format!("{}:{remote_id}", endpoint.host_str().unwrap_or_default());
        let cell = {
            let mut requests = self.requests.lock().await;
            requests
                .entry(key.clone())
                .or_insert_with(|| Arc::new(OnceCell::new()))
                .clone()
        };
        let result = cell
            .get_or_try_init(|| async {
                let _permit = self.semaphore.acquire().await.map_err(|_| {
                    MangaVaultError::Message("metadata provider closed".to_string())
                })?;
                self.wait_for_rate_limit(request_interval).await;
                fetch_remote(&self.client, endpoint, remote_id).await
            })
            .await
            .cloned();
        self.requests.lock().await.remove(&key);
        result
    }

    async fn wait_for_rate_limit(&self, interval: Duration) {
        let mut last_request = self.last_request.lock().await;
        if let Some(last) = *last_request {
            let elapsed = last.elapsed();
            if elapsed < interval {
                tokio::time::sleep(interval - elapsed).await;
            }
        }
        *last_request = Some(Instant::now());
    }
}

async fn fetch_remote(
    client: &Client,
    mut endpoint: Url,
    remote_id: &str,
) -> Result<JmComicRemoteMetadata> {
    endpoint.set_path("/album/");
    endpoint.set_query(None);
    endpoint
        .query_pairs_mut()
        .append_pair("comicName", "")
        .append_pair("id", remote_id);
    let timestamp = chrono::Utc::now().timestamp().to_string();
    let token = md5_hex(format!("{timestamp}{API_TOKEN_SECRET}").as_bytes());
    let mut response = client
        .get(endpoint)
        .header("tokenparam", format!("{timestamp},{API_HEADER_VERSION}"))
        .header("token", token)
        .header("version", "v1.1.0")
        .send()
        .await
        .map_err(network_error)?;
    if response.status().is_redirection() {
        return Err(MangaVaultError::Message(
            "JMComic metadata endpoint attempted an unapproved redirect".to_string(),
        ));
    }
    if !response.status().is_success() {
        return Err(MangaVaultError::Message(format!(
            "JMComic metadata request failed with HTTP {}",
            response.status().as_u16()
        )));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err(MangaVaultError::Message(
            "JMComic metadata response exceeded the 2 MiB limit".to_string(),
        ));
    }
    let mut body = Vec::with_capacity(
        response
            .content_length()
            .unwrap_or(16 * 1024)
            .min(MAX_RESPONSE_BYTES as u64) as usize,
    );
    while let Some(chunk) = response.chunk().await.map_err(network_error)? {
        if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err(MangaVaultError::Message(
                "JMComic metadata response exceeded the 2 MiB limit".to_string(),
            ));
        }
        body.extend_from_slice(&chunk);
    }
    parse_envelope(&body, &timestamp, remote_id)
}

fn parse_envelope(body: &[u8], timestamp: &str, remote_id: &str) -> Result<JmComicRemoteMetadata> {
    let envelope: Value = serde_json::from_slice(body)
        .map_err(|_| MangaVaultError::Message("JMComic returned invalid JSON".to_string()))?;
    if envelope.get("code").and_then(Value::as_i64) != Some(200) {
        let message = envelope
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("provider rejected the request");
        return Err(MangaVaultError::Message(format!(
            "JMComic metadata unavailable: {}",
            truncate(message, 160)
        )));
    }
    let encrypted = envelope
        .get("data")
        .and_then(Value::as_str)
        .ok_or_else(|| MangaVaultError::Message("JMComic response had no data".to_string()))?;
    let decoded = decrypt_payload(encrypted, timestamp)?;
    parse_metadata_payload(&decoded, remote_id)
}

fn decrypt_payload(encoded: &str, timestamp: &str) -> Result<Vec<u8>> {
    let mut bytes = STANDARD.decode(encoded).map_err(|_| {
        MangaVaultError::Message("JMComic response data was not valid base64".to_string())
    })?;
    if bytes.is_empty() || bytes.len() % 16 != 0 {
        return Err(MangaVaultError::Message(
            "JMComic response data had an invalid encrypted length".to_string(),
        ));
    }
    let key_hex = md5_hex(format!("{timestamp}{API_DATA_SECRET}").as_bytes());
    let mut cipher = Aes256::new_from_slice(key_hex.as_bytes())
        .map_err(|_| MangaVaultError::Message("JMComic decryption key was invalid".to_string()))?;
    for block in bytes.chunks_exact_mut(16) {
        cipher.decrypt_block_mut(block.into());
    }
    let padding = *bytes
        .last()
        .ok_or_else(|| MangaVaultError::Message("JMComic response was empty".to_string()))?
        as usize;
    if padding == 0
        || padding > 16
        || padding > bytes.len()
        || !bytes[bytes.len() - padding..]
            .iter()
            .all(|value| *value as usize == padding)
    {
        return Err(MangaVaultError::Message(
            "JMComic response padding was invalid".to_string(),
        ));
    }
    bytes.truncate(bytes.len() - padding);
    Ok(bytes)
}

fn parse_metadata_payload(payload: &[u8], expected_id: &str) -> Result<JmComicRemoteMetadata> {
    let raw: Value = serde_json::from_slice(payload).map_err(|_| {
        MangaVaultError::Message("JMComic metadata payload was invalid".to_string())
    })?;
    let remote_id = value_as_id(raw.get("id"))
        .ok_or_else(|| MangaVaultError::Message("JMComic metadata had no ID".to_string()))?;
    if remote_id != expected_id {
        return Err(MangaVaultError::Message(
            "JMComic metadata ID did not match the requested work".to_string(),
        ));
    }
    let original_title = clean_optional(raw.get("name"), 1024);
    let authors = string_list(raw.get("author"), 64, 160);
    let tags = string_list(raw.get("tags"), 256, 160);
    let mut categories = string_list(raw.get("category"), 16, 160);
    categories.extend(string_list(raw.get("category_sub"), 16, 160));
    categories.sort();
    categories.dedup();
    let chapters = raw
        .get("series")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(2048)
        .filter_map(|item| {
            Some(ExternalChapterMetadata {
                remote_id: value_as_id(item.get("id"))?,
                name: clean_optional(item.get("name"), 512),
                sort: item.get("sort").and_then(value_as_i64),
            })
        })
        .collect::<Vec<_>>();
    Ok(JmComicRemoteMetadata {
        remote_id: remote_id.clone(),
        original_title,
        authors,
        categories,
        tags,
        description: clean_optional(raw.get("description"), 16_384),
        chapters,
        remote_cover_url: Some(format!("/media/albums/{remote_id}_3x4.jpg")),
        payload_hash: blake3::hash(payload).to_hex().to_string(),
    })
}

fn validated_endpoint(endpoint: &str) -> Result<Url> {
    let url = Url::parse(endpoint)
        .map_err(|_| MangaVaultError::Message("invalid JMComic metadata endpoint".to_string()))?;
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if url.scheme() != "https"
        || !ALLOWED_API_HOSTS.contains(&host.as_str())
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(MangaVaultError::Message(
            "JMComic endpoint is outside the HTTPS allowlist".to_string(),
        ));
    }
    Ok(url)
}

fn validate_remote_id(remote_id: &str) -> Result<()> {
    if remote_id.is_empty()
        || remote_id.len() > 20
        || !remote_id.bytes().all(|value| value.is_ascii_digit())
    {
        return Err(MangaVaultError::Message("invalid JM ID".to_string()));
    }
    Ok(())
}

fn string_list(value: Option<&Value>, max_items: usize, max_len: usize) -> Vec<String> {
    let mut values = match value {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|item| match item {
                Value::String(_) | Value::Number(_) => clean_optional(Some(item), max_len),
                Value::Object(object) => {
                    clean_optional(object.get("name").or_else(|| object.get("title")), max_len)
                }
                _ => None,
            })
            .take(max_items)
            .collect::<Vec<_>>(),
        Some(Value::Object(object)) => {
            clean_optional(object.get("name").or_else(|| object.get("title")), max_len)
                .into_iter()
                .collect()
        }
        Some(item) => clean_optional(Some(item), max_len).into_iter().collect(),
        None => Vec::new(),
    };
    values.sort();
    values.dedup();
    values
}

fn clean_optional(value: Option<&Value>, max_len: usize) -> Option<String> {
    let value = match value? {
        Value::String(value) => value.clone(),
        Value::Number(value) => value.to_string(),
        _ => return None,
    };
    let value = value.trim().chars().take(max_len).collect::<String>();
    (!value.is_empty()).then_some(value)
}

fn value_as_id(value: Option<&Value>) -> Option<String> {
    clean_optional(value, 20).filter(|value| value.bytes().all(|byte| byte.is_ascii_digit()))
}

fn value_as_i64(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
}

fn md5_hex(value: &[u8]) -> String {
    format!("{:x}", Md5::digest(value))
}

fn truncate(value: &str, max_len: usize) -> String {
    value.chars().take(max_len).collect()
}

fn network_error(error: reqwest::Error) -> MangaVaultError {
    let category = if error.is_timeout() {
        "timed out"
    } else if error.is_connect() {
        "could not connect"
    } else if error.is_decode() {
        "returned invalid data"
    } else {
        "failed"
    };
    MangaVaultError::Message(format!("JMComic metadata request {category}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use aes::cipher::BlockEncryptMut;

    fn encrypted_envelope(timestamp: &str, payload: &str) -> Vec<u8> {
        let mut bytes = payload.as_bytes().to_vec();
        let padding = 16 - bytes.len() % 16;
        bytes.extend(std::iter::repeat_n(padding as u8, padding));
        let key_hex = md5_hex(format!("{timestamp}{API_DATA_SECRET}").as_bytes());
        let mut cipher = Aes256::new_from_slice(key_hex.as_bytes()).unwrap();
        for block in bytes.chunks_exact_mut(16) {
            cipher.encrypt_block_mut(block.into());
        }
        serde_json::to_vec(&serde_json::json!({
            "code": 200,
            "data": STANDARD.encode(bytes)
        }))
        .unwrap()
    }

    #[test]
    fn decrypts_and_validates_metadata_payload() {
        let timestamp = "1786550400";
        let body = encrypted_envelope(
            timestamp,
            r#"{
              "id":12345,
              "name":" Source title ",
              "author":["Author B","Author A"],
              "tags":["Tag B","Tag A","Tag A"],
              "category":{"title":"Manga"},
              "category_sub":{"title":"Short"},
              "description":"Description",
              "series":[{"id":12346,"name":"Episode 1","sort":"1"}]
            }"#,
        );

        let metadata = parse_envelope(&body, timestamp, "12345").unwrap();

        assert_eq!(metadata.remote_id, "12345");
        assert_eq!(metadata.original_title.as_deref(), Some("Source title"));
        assert_eq!(metadata.authors, vec!["Author A", "Author B"]);
        assert_eq!(metadata.tags, vec!["Tag A", "Tag B"]);
        assert_eq!(metadata.categories, vec!["Manga", "Short"]);
        assert_eq!(metadata.chapters[0].remote_id, "12346");
    }

    #[test]
    fn rejects_mismatched_ids_and_unapproved_endpoints() {
        let timestamp = "1786550400";
        let body = encrypted_envelope(timestamp, r#"{"id":12345,"name":"Title"}"#);
        assert!(parse_envelope(&body, timestamp, "99999").is_err());
        assert!(validated_endpoint("http://www.cdngwc.cc").is_err());
        assert!(validated_endpoint("https://127.0.0.1").is_err());
        assert!(validated_endpoint("https://example.com").is_err());
        assert!(validated_endpoint("https://www.cdngwc.cc").is_ok());
    }

    #[test]
    fn rejects_invalid_padding_and_remote_ids() {
        assert!(decrypt_payload("AA==", "1").is_err());
        assert!(validate_remote_id("12a").is_err());
        assert!(validate_remote_id("").is_err());
        assert!(validate_remote_id("12345").is_ok());
    }
}
