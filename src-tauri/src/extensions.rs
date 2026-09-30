use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};

use crate::{
    error::{MangaVaultError, Result},
    process::background_command,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PluginPermission {
    ReadMetadata,
    WriteMetadata,
    ReadLibraryPaths,
    RunExternalProcess,
    UseAiProvider,
    UseSyncProvider,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginContribution {
    pub kind: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub permissions: Vec<PluginPermission>,
    pub contributions: Vec<PluginContribution>,
}

impl PluginManifest {
    pub fn validate(&self) -> Result<()> {
        validate_id("plugin id", &self.id)?;
        if self.name.trim().is_empty() {
            return Err(MangaVaultError::Message(
                "plugin name is required".to_string(),
            ));
        }
        if self.version.trim().is_empty() {
            return Err(MangaVaultError::Message(
                "plugin version is required".to_string(),
            ));
        }
        Ok(())
    }
}

pub trait PluginRegistry {
    fn register_manifest(&mut self, manifest: PluginManifest) -> Result<()>;
    fn is_enabled(&self, plugin_id: &str) -> bool;
    fn set_enabled(&mut self, plugin_id: &str, enabled: bool) -> Result<()>;
}

#[derive(Default)]
pub struct ManifestOnlyPluginRegistry {
    manifests: HashMap<String, PluginManifest>,
    enabled: HashSet<String>,
}

impl PluginRegistry for ManifestOnlyPluginRegistry {
    fn register_manifest(&mut self, manifest: PluginManifest) -> Result<()> {
        manifest.validate()?;
        self.manifests.insert(manifest.id.clone(), manifest);
        Ok(())
    }

    fn is_enabled(&self, plugin_id: &str) -> bool {
        self.enabled.contains(plugin_id)
    }

    fn set_enabled(&mut self, plugin_id: &str, enabled: bool) -> Result<()> {
        if !self.manifests.contains_key(plugin_id) {
            return Err(MangaVaultError::Message(format!(
                "plugin is not registered: {plugin_id}"
            )));
        }
        if enabled {
            self.enabled.insert(plugin_id.to_string());
        } else {
            self.enabled.remove(plugin_id);
        }
        Ok(())
    }
}

pub trait PluginEventBus {
    fn publish(&self, event: PluginEvent);
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginEvent {
    pub topic: String,
    pub payload_json: String,
}

pub trait MetadataProvider {
    fn id(&self) -> &str;
}

pub trait MetadataParser {
    fn parse_filename(&self, file_name: &str) -> ParsedMetadata;
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ParsedMetadata {
    pub title: String,
    pub author: Option<String>,
    pub volume: Option<f64>,
    pub chapter: Option<f64>,
    pub language: Option<String>,
    pub year: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ComicInfo {
    pub title: Option<String>,
    pub series: Option<String>,
    pub number: Option<String>,
    pub volume: Option<i64>,
    pub writer: Option<String>,
    pub language_iso: Option<String>,
    pub year: Option<i64>,
    pub tags: Vec<String>,
}

pub struct BasicFilenameMetadataParser;

impl MetadataParser for BasicFilenameMetadataParser {
    fn parse_filename(&self, file_name: &str) -> ParsedMetadata {
        let parsed = crate::scanner::parse_title(file_name);
        ParsedMetadata {
            title: parsed.title,
            author: parsed.author,
            volume: parsed.volume,
            chapter: parsed.chapter,
            language: parse_language_hint(file_name),
            year: parse_year_hint(file_name),
        }
    }
}

pub trait MetadataEditService {
    fn validate_field_name(&self, field_name: &str) -> bool;
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReaderProfile {
    pub id: String,
    pub name: String,
    pub mode: String,
    pub direction: String,
    pub fit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PerBookReaderSettings {
    pub book_id: i64,
    pub profile_id: Option<String>,
    pub settings_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PerSeriesReaderSettings {
    pub series_id: i64,
    pub profile_id: Option<String>,
    pub settings_json: String,
}

pub trait ImagePreprocessPipeline {
    fn steps(&self) -> Vec<String>;
}

pub trait PageTransform {
    fn id(&self) -> &str;
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SmartCollection {
    pub id: String,
    pub name: String,
    pub query_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRoot {
    pub id: String,
    pub root_path: PathBuf,
    pub recursive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SeriesMergePlan {
    pub source_series_ids: Vec<i64>,
    pub target_title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SortRule {
    pub field: String,
    pub ascending: bool,
}

pub trait DuplicateDetectionService {
    fn provider_id(&self) -> &str;
}

pub trait FileOrganizerService {
    fn provider_id(&self) -> &str;
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiFeatureFlags {
    pub library_organizer: bool,
    pub cover_text: bool,
    pub summaries: bool,
    pub recommendations: bool,
}

pub trait AiProvider {
    fn id(&self) -> &str;
    fn is_enabled(&self) -> bool;
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiProviderConfig {
    pub executable_path: Option<PathBuf>,
    pub model_path: Option<PathBuf>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CloudAiProviderConfig {
    pub endpoint: Option<String>,
    pub allow_file_upload: bool,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiTask {
    pub id: String,
    pub kind: String,
    pub status: String,
}

pub trait AiTaskQueue {
    fn enqueue(&mut self, task: AiTask) -> Result<()>;
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpscaleSettings {
    pub enabled: bool,
    pub provider_id: Option<String>,
    pub scale: u8,
    pub denoise: u8,
    pub sharpen: u8,
    pub line_art_mode: bool,
    pub color_manga_mode: bool,
    pub monochrome_manga_mode: bool,
    pub repair_compression: bool,
    pub output_format: String,
    pub output_quality: u8,
    pub model_path: Option<PathBuf>,
    pub device: String,
    pub realtime_in_reader: bool,
    pub background_precompute: bool,
    pub cache_limit_mb: u64,
}

impl Default for UpscaleSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            provider_id: None,
            scale: 2,
            denoise: 0,
            sharpen: 0,
            line_art_mode: false,
            color_manga_mode: false,
            monochrome_manga_mode: false,
            repair_compression: false,
            output_format: "webp".to_string(),
            output_quality: 90,
            model_path: None,
            device: "auto".to_string(),
            realtime_in_reader: false,
            background_precompute: false,
            cache_limit_mb: 2048,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpscaleJob {
    pub id: String,
    pub input_path: PathBuf,
    pub output_path: PathBuf,
    pub status: UpscaleJobStatus,
    pub scale: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UpscaleJobStatus {
    Queued,
    Running,
    Complete,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpscaleResult {
    pub job_id: String,
    pub output_path: PathBuf,
    pub used_original: bool,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelDescriptor {
    pub id: String,
    pub name: String,
    pub path: Option<PathBuf>,
    pub supported_scales: Vec<u8>,
}

pub trait ModelRegistry {
    fn list_models(&self) -> Vec<ModelDescriptor>;
}

pub trait ImageEnhanceProvider {
    fn id(&self) -> &str;
}

pub trait ImageEnhancePipeline {
    fn provider_ids(&self) -> Vec<String>;
}

pub trait UpscaleCache {
    fn clear(&self) -> Result<usize>;
}

#[derive(Default)]
pub struct InMemoryUpscaleQueue {
    jobs: HashMap<String, UpscaleJob>,
}

impl InMemoryUpscaleQueue {
    pub fn create(&mut self, job: UpscaleJob) -> Result<()> {
        validate_id("upscale job id", &job.id)?;
        self.jobs.insert(job.id.clone(), job);
        Ok(())
    }

    pub fn cancel(&mut self, job_id: &str) -> Result<()> {
        let job = self
            .jobs
            .get_mut(job_id)
            .ok_or_else(|| MangaVaultError::Message(format!("upscale job not found: {job_id}")))?;
        job.status = UpscaleJobStatus::Cancelled;
        Ok(())
    }

    pub fn get(&self, job_id: &str) -> Option<&UpscaleJob> {
        self.jobs.get(job_id)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalCommandProfile {
    pub executable_path: PathBuf,
    pub arguments_template: String,
    pub working_dir: Option<PathBuf>,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalProcessResult {
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Default)]
pub struct ExternalProcessRunner;

impl ExternalProcessRunner {
    pub fn validate_profile(&self, profile: &ExternalCommandProfile) -> Result<PathBuf> {
        let executable = profile.executable_path.canonicalize()?;
        if !executable.is_file() {
            return Err(MangaVaultError::InvalidPath);
        }
        if profile.timeout_ms == 0 || profile.timeout_ms > 30 * 60 * 1000 {
            return Err(MangaVaultError::Message(
                "external command timeout must be between 1 ms and 30 minutes".to_string(),
            ));
        }
        if let Some(working_dir) = &profile.working_dir {
            let canonical = working_dir.canonicalize()?;
            if !canonical.is_dir() {
                return Err(MangaVaultError::InvalidPath);
            }
        }
        Ok(executable)
    }

    pub fn build_args(
        &self,
        template: &str,
        values: &HashMap<&str, String>,
    ) -> Result<Vec<String>> {
        parse_argument_template(template)?
            .into_iter()
            .map(|token| replace_placeholders(&token, values))
            .collect()
    }

    pub fn run(
        &self,
        profile: &ExternalCommandProfile,
        values: &HashMap<&str, String>,
    ) -> Result<ExternalProcessResult> {
        let executable = self.validate_profile(profile)?;
        let args = self.build_args(&profile.arguments_template, values)?;
        let mut command = background_command(executable);
        command.args(args);
        if let Some(working_dir) = &profile.working_dir {
            command.current_dir(working_dir);
        }
        let mut child = command
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()?;
        let deadline = Instant::now() + Duration::from_millis(profile.timeout_ms);
        loop {
            if let Some(status) = child.try_wait()? {
                let output = child.wait_with_output()?;
                return Ok(ExternalProcessResult {
                    exit_code: status.code(),
                    timed_out: false,
                    stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                    stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                });
            }
            if Instant::now() >= deadline {
                let _ = child.kill();
                let output = child.wait_with_output()?;
                return Ok(ExternalProcessResult {
                    exit_code: None,
                    timed_out: true,
                    stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                    stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                });
            }
            thread::sleep(Duration::from_millis(10));
        }
    }
}

pub trait UpscaleProvider {
    fn id(&self) -> &str;
    fn name(&self) -> &str;
    fn capabilities(&self) -> Vec<String>;
    fn is_available(&self) -> bool;
    fn validate_config(&self) -> Result<()>;
    fn upscale(&self, job: &UpscaleJob, settings: &UpscaleSettings) -> Result<UpscaleResult>;
    fn cancel(&self, job_id: &str) -> Result<()>;
}

pub struct LocalCliUpscaleProvider {
    pub provider_id: String,
    pub provider_name: String,
    pub profile: ExternalCommandProfile,
    runner: ExternalProcessRunner,
}

impl LocalCliUpscaleProvider {
    pub fn new(
        provider_id: String,
        provider_name: String,
        profile: ExternalCommandProfile,
    ) -> Self {
        Self {
            provider_id,
            provider_name,
            profile,
            runner: ExternalProcessRunner,
        }
    }
}

impl UpscaleProvider for LocalCliUpscaleProvider {
    fn id(&self) -> &str {
        &self.provider_id
    }

    fn name(&self) -> &str {
        &self.provider_name
    }

    fn capabilities(&self) -> Vec<String> {
        vec![
            "local-cli".to_string(),
            "single-page".to_string(),
            "batch-queue-ready".to_string(),
        ]
    }

    fn is_available(&self) -> bool {
        self.runner.validate_profile(&self.profile).is_ok()
    }

    fn validate_config(&self) -> Result<()> {
        validate_id("provider id", &self.provider_id)?;
        self.runner.validate_profile(&self.profile)?;
        Ok(())
    }

    fn upscale(&self, job: &UpscaleJob, settings: &UpscaleSettings) -> Result<UpscaleResult> {
        if !settings.enabled {
            return Err(MangaVaultError::Message(
                "upscale provider is disabled".to_string(),
            ));
        }
        validate_input_path(&job.input_path)?;
        validate_output_dir(&job.output_path)?;
        let mut values = HashMap::new();
        values.insert("input", job.input_path.to_string_lossy().to_string());
        values.insert("output", job.output_path.to_string_lossy().to_string());
        values.insert("scale", settings.scale.to_string());
        values.insert(
            "model",
            settings
                .model_path
                .as_ref()
                .map(|path| path.to_string_lossy().to_string())
                .unwrap_or_default(),
        );
        values.insert("device", settings.device.clone());
        values.insert("format", settings.output_format.clone());
        values.insert("quality", settings.output_quality.to_string());

        let result = self.runner.run(&self.profile, &values)?;
        Ok(UpscaleResult {
            job_id: job.id.clone(),
            output_path: if result.exit_code == Some(0) && !result.timed_out {
                job.output_path.clone()
            } else {
                job.input_path.clone()
            },
            used_original: result.exit_code != Some(0) || result.timed_out,
            stdout: result.stdout,
            stderr: result.stderr,
        })
    }

    fn cancel(&self, _job_id: &str) -> Result<()> {
        Ok(())
    }
}

#[derive(Default)]
pub struct UpscaleProviderRegistry {
    providers: HashMap<String, Box<dyn UpscaleProvider + Send + Sync>>,
}

impl UpscaleProviderRegistry {
    pub fn register(&mut self, provider: Box<dyn UpscaleProvider + Send + Sync>) -> Result<()> {
        validate_id("provider id", provider.id())?;
        self.providers.insert(provider.id().to_string(), provider);
        Ok(())
    }

    pub fn get(&self, provider_id: &str) -> Option<&(dyn UpscaleProvider + Send + Sync)> {
        self.providers
            .get(provider_id)
            .map(|provider| provider.as_ref())
    }

    pub fn len(&self) -> usize {
        self.providers.len()
    }

    pub fn is_empty(&self) -> bool {
        self.providers.is_empty()
    }
}

pub trait OcrProvider {
    fn id(&self) -> &str;
}

pub trait TranslationProvider {
    fn id(&self) -> &str;
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextRegion {
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TranslationOverlay {
    pub source_locale: String,
    pub target_locale: String,
    pub regions: Vec<TextRegion>,
}

pub trait OcrCache {
    fn clear(&self) -> Result<usize>;
}

pub trait TranslationCache {
    fn clear(&self) -> Result<usize>;
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncSettings {
    pub enabled: bool,
    pub provider_id: Option<String>,
    pub end_to_end_encryption: bool,
    pub automatic_sync: bool,
}

impl Default for SyncSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            provider_id: None,
            end_to_end_encryption: true,
            automatic_sync: false,
        }
    }
}

pub trait SyncProvider {
    fn id(&self) -> &str;
    fn is_enabled(&self) -> bool;
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncItem {
    pub kind: String,
    pub key: String,
    pub payload_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncConflict {
    pub item: SyncItem,
    pub local_json: String,
    pub remote_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncLog {
    pub provider_id: String,
    pub status: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum JobPriority {
    Low,
    Normal,
    High,
    ReaderCritical,
}

pub trait JobCancellation {
    fn is_cancelled(&self, job_id: &str) -> bool;
}

pub trait TaskQueue {
    fn enqueue(&mut self, job_id: String, priority: JobPriority) -> Result<()>;
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CachePolicy {
    pub max_bytes: u64,
    pub max_age_days: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryBudget {
    pub low_memory_mode: bool,
    pub max_reader_cache_mb: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceDiagnostics {
    pub slow_query_logging: bool,
    pub capture_decode_timings: bool,
}

pub trait SlowQueryLog {
    fn record(&self, sql_label: &str, elapsed_ms: u64);
}

pub trait BackupService {
    fn create_backup(&self, reason: &str) -> Result<PathBuf>;
}

pub trait RecoveryService {
    fn safe_mode_enabled(&self) -> bool;
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ErrorReport {
    pub summary: String,
    pub details: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CacheRebuildJob {
    pub id: String,
    pub cache_kind: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ThemePreset {
    pub id: String,
    pub name: String,
    pub colors_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LayoutSettings {
    pub cover_ratio: String,
    pub grid_density: String,
    pub sidebar_mode: String,
}

pub trait KeyboardShortcutRegistry {
    fn register_shortcut(&mut self, command_id: &str, accelerator: &str) -> Result<()>;
}

pub trait CommandRegistry {
    fn register_command(&mut self, command_id: &str, title: &str) -> Result<()>;
}

pub trait FeatureFlagService {
    fn is_enabled(&self, key: &str) -> bool;
}

#[derive(Default)]
pub struct DefaultFeatureFlagService {
    enabled: HashSet<String>,
}

impl FeatureFlagService for DefaultFeatureFlagService {
    fn is_enabled(&self, key: &str) -> bool {
        self.enabled.contains(key)
    }
}

pub trait LicenseService {
    fn status(&self) -> String;
}

pub trait TelemetryService {
    fn is_enabled(&self) -> bool;
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivacySettings {
    pub telemetry_enabled: bool,
    pub cloud_sync_enabled: bool,
    pub cloud_ai_enabled: bool,
    pub allow_file_upload: bool,
}

fn validate_id(label: &str, id: &str) -> Result<()> {
    if id.is_empty()
        || !id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_'))
    {
        return Err(MangaVaultError::Message(format!("invalid {label}: {id}")));
    }
    Ok(())
}

fn validate_input_path(path: &Path) -> Result<()> {
    let canonical = path.canonicalize()?;
    if !canonical.is_file() {
        return Err(MangaVaultError::InvalidPath);
    }
    Ok(())
}

fn validate_output_dir(path: &Path) -> Result<()> {
    let parent = path.parent().ok_or(MangaVaultError::InvalidPath)?;
    let canonical = parent.canonicalize()?;
    if !canonical.is_dir() {
        return Err(MangaVaultError::InvalidPath);
    }
    let probe = canonical.join(".mangavault-write-probe");
    std::fs::write(&probe, b"probe")?;
    std::fs::remove_file(probe)?;
    Ok(())
}

fn parse_argument_template(template: &str) -> Result<Vec<String>> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut in_quote = false;
    let mut chars = template.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '"' => in_quote = !in_quote,
            '\\' if in_quote && chars.peek() == Some(&'"') => {
                current.push('"');
                chars.next();
            }
            ch if ch.is_whitespace() && !in_quote => {
                if !current.is_empty() {
                    args.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(ch),
        }
    }
    if in_quote {
        return Err(MangaVaultError::Message(
            "argument template has an unterminated quote".to_string(),
        ));
    }
    if !current.is_empty() {
        args.push(current);
    }
    Ok(args)
}

fn replace_placeholders(token: &str, values: &HashMap<&str, String>) -> Result<String> {
    let mut output = token.to_string();
    for (key, value) in values {
        output = output.replace(&format!("{{{key}}}"), value);
    }
    if output.contains('{') || output.contains('}') {
        return Err(MangaVaultError::Message(format!(
            "unknown placeholder in argument template: {token}"
        )));
    }
    Ok(output)
}

fn parse_language_hint(file_name: &str) -> Option<String> {
    for locale in ["zh-CN", "zh-TW", "en", "ja", "ko"] {
        if file_name
            .to_ascii_lowercase()
            .contains(&locale.to_ascii_lowercase())
        {
            return Some(locale.to_string());
        }
    }
    None
}

fn parse_year_hint(file_name: &str) -> Option<i64> {
    let re = regex::Regex::new(r"\b(19\d{2}|20\d{2})\b").ok()?;
    re.captures(file_name)
        .and_then(|caps| caps.get(1))
        .and_then(|year| year.as_str().parse::<i64>().ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestProvider {
        id: String,
    }

    impl UpscaleProvider for TestProvider {
        fn id(&self) -> &str {
            &self.id
        }

        fn name(&self) -> &str {
            "Test Provider"
        }

        fn capabilities(&self) -> Vec<String> {
            vec!["test".to_string()]
        }

        fn is_available(&self) -> bool {
            true
        }

        fn validate_config(&self) -> Result<()> {
            Ok(())
        }

        fn upscale(&self, job: &UpscaleJob, _settings: &UpscaleSettings) -> Result<UpscaleResult> {
            Ok(UpscaleResult {
                job_id: job.id.clone(),
                output_path: job.output_path.clone(),
                used_original: false,
                stdout: String::new(),
                stderr: String::new(),
            })
        }

        fn cancel(&self, _job_id: &str) -> Result<()> {
            Ok(())
        }
    }

    #[test]
    fn provider_registry_registers_by_id() {
        let mut registry = UpscaleProviderRegistry::default();
        registry
            .register(Box::new(TestProvider {
                id: "local.test".to_string(),
            }))
            .unwrap();

        assert_eq!(registry.len(), 1);
        assert!(registry.get("local.test").is_some());
    }

    #[test]
    fn plugin_manifest_validation_rejects_unsafe_ids() {
        let manifest = PluginManifest {
            id: "../escape".to_string(),
            name: "Bad".to_string(),
            version: "1.0.0".to_string(),
            permissions: vec![],
            contributions: vec![],
        };

        assert!(manifest.validate().is_err());
    }

    #[test]
    fn plugin_registry_keeps_plugins_disabled_by_default() {
        let mut registry = ManifestOnlyPluginRegistry::default();
        registry
            .register_manifest(PluginManifest {
                id: "local.metadata".to_string(),
                name: "Local Metadata".to_string(),
                version: "1.0.0".to_string(),
                permissions: vec![PluginPermission::ReadMetadata],
                contributions: vec![],
            })
            .unwrap();

        assert!(!registry.is_enabled("local.metadata"));
    }

    #[test]
    fn advanced_features_are_disabled_by_default() {
        let ai = AiFeatureFlags::default();
        let sync = SyncSettings::default();
        let privacy = PrivacySettings::default();
        let upscale = UpscaleSettings::default();
        let features = DefaultFeatureFlagService::default();

        assert!(!ai.library_organizer);
        assert!(!sync.enabled);
        assert!(!privacy.telemetry_enabled);
        assert!(!privacy.allow_file_upload);
        assert!(!upscale.enabled);
        assert!(!features.is_enabled("ai.upscale"));
    }

    #[test]
    fn external_command_rejects_missing_executable() {
        let runner = ExternalProcessRunner;
        let profile = ExternalCommandProfile {
            executable_path: PathBuf::from("Z:/missing/mangavault-upscale.exe"),
            arguments_template: "{input} {output}".to_string(),
            working_dir: None,
            timeout_ms: 1000,
        };

        assert!(runner.validate_profile(&profile).is_err());
    }

    #[test]
    fn external_command_template_keeps_placeholder_values_as_single_args() {
        let runner = ExternalProcessRunner;
        let mut values = HashMap::new();
        values.insert("input", "C:/Images/a page;rm -rf.png".to_string());
        values.insert("output", "C:/Out/page.webp".to_string());
        values.insert("scale", "4".to_string());

        let args = runner
            .build_args("--input {input} --output {output} --scale {scale}", &values)
            .unwrap();

        assert_eq!(args[1], "C:/Images/a page;rm -rf.png");
        assert_eq!(args[5], "4");
    }

    #[test]
    fn upscale_queue_creates_and_cancels_jobs() {
        let mut queue = InMemoryUpscaleQueue::default();
        queue
            .create(UpscaleJob {
                id: "job-1".to_string(),
                input_path: PathBuf::from("input.png"),
                output_path: PathBuf::from("output.webp"),
                status: UpscaleJobStatus::Queued,
                scale: 2,
            })
            .unwrap();

        queue.cancel("job-1").unwrap();
        assert_eq!(
            queue.get("job-1").unwrap().status,
            UpscaleJobStatus::Cancelled
        );
    }

    #[test]
    fn local_cli_upscale_falls_back_to_original_on_command_failure() {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("input.png");
        let output = dir.path().join("output.webp");
        std::fs::write(&input, b"image").unwrap();
        let exe = std::env::current_exe().unwrap();
        let provider = LocalCliUpscaleProvider::new(
            "local.cli".to_string(),
            "Local CLI".to_string(),
            ExternalCommandProfile {
                executable_path: exe,
                arguments_template: "--definitely-not-a-real-test-flag {input} {output}"
                    .to_string(),
                working_dir: None,
                timeout_ms: 5000,
            },
        );
        let settings = UpscaleSettings {
            enabled: true,
            ..UpscaleSettings::default()
        };
        let job = UpscaleJob {
            id: "job-1".to_string(),
            input_path: input.clone(),
            output_path: output,
            status: UpscaleJobStatus::Queued,
            scale: 2,
        };

        let result = provider.upscale(&job, &settings).unwrap();
        assert!(result.used_original);
        assert_eq!(result.output_path, input);
    }
}
