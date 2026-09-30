export type ReaderMode = "single" | "double" | "scroll";
export type ReaderDirection = "ltr" | "rtl";
export type ReaderFit = "width" | "height" | "original";
export type ReaderControlsLayout = "auto" | "overlay" | "reserved";
export type LibraryView = "grid" | "list" | "wall" | "series";

export interface Library {
  id: number;
  name: string;
  rootPath: string;
  recursive: boolean;
  createdAt: string;
  updatedAt: string;
  lastScanAt: string | null;
  bookCount: number;
}

export interface Book {
  id: number;
  libraryId: number | null;
  seriesId: number | null;
  title: string;
  sortTitle: string;
  author: string | null;
  volume: number | null;
  chapter: number | null;
  path: string;
  format: string;
  fileSize: number;
  modifiedAt: string | null;
  pageCount: number;
  coverPageIndex: number;
  coverCacheKey: string | null;
  isFavorite: boolean;
  rating: number;
  status: string;
  importedAt: string;
  updatedAt: string;
  lastReadAt: string | null;
  progressPercent: number;
  tags: string[];
}

export interface BookPage {
  id: number;
  bookId: number;
  pageIndex: number;
  sourcePath: string;
  width: number | null;
  height: number | null;
  byteSize: number | null;
}

export interface Chapter {
  id: number;
  bookId: number;
  title: string;
  chapterNumber: number | null;
  startPage: number;
  pageCount: number;
  createdAt: string;
}

export interface PagePayload {
  pageIndex: number;
  mimeType: string;
  dataUrl: string;
  filePath?: string | null;
}

export interface Bookmark {
  id: number;
  bookId: number;
  pageIndex: number;
  note: string | null;
  createdAt: string;
}

export interface ReadingProgress {
  bookId: number;
  currentPage: number;
  totalPages: number;
  percent: number;
  mode: string;
  direction: string;
  updatedAt: string;
}

export interface ScanJob {
  id: number;
  libraryId: number | null;
  rootPath: string;
  status: string;
  discoveredCount: number;
  importedCount: number;
  failedCount: number;
  message: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface ScanFailure {
  id: number;
  scanJobId: number;
  path: string | null;
  stage: string;
  message: string;
  createdAt: string;
}

export interface FormatCapability {
  format: string;
  available: boolean;
  detail: string;
}

export interface ReadingHistoryItem {
  bookId: number;
  title: string;
  pageIndex: number;
  totalPages: number;
  openedAt: string;
  path: string;
}

export type RecentReadingFilter = "all" | "unfinished" | "finished" | "today" | "7days" | "30days";
export type RecentReadingSort = "recent" | "progress" | "title";
export type RecentReadingView = "grid" | "list";

export interface RecentReadingQuery {
  search?: string;
  filter?: RecentReadingFilter;
  sort?: RecentReadingSort;
  limit?: number;
  offset?: number;
  timezoneOffsetMinutes?: number;
}

export interface RecentReadingItem {
  book: Book;
  currentPage: number;
  totalPages: number;
  progressPercent: number;
  lastReadAt: string;
  isFinished: boolean;
}

export interface RecentReadingPage {
  items: RecentReadingItem[];
  total: number;
  offset: number;
  limit: number;
}

export interface LocalDataSummary {
  libraries: number;
  books: number;
  readingHistory: number;
  readingProgress: number;
  bookmarks: number;
}

export interface DatabaseResetSchedule {
  backupPath: string;
  scheduledAt: string;
  restartRequired: boolean;
}

export interface DatabaseResetOutcome {
  success: boolean;
  backupPath: string | null;
  archivePath: string | null;
  message: string;
  resetAt: string;
}

export interface StartupDataStatus {
  appDataPath: string;
  hadExistingDatabase: boolean;
  shouldPrompt: boolean;
  summary: LocalDataSummary;
  resetOutcome: DatabaseResetOutcome | null;
}

export interface DatabaseHealth {
  ok: boolean;
  message: string;
  backupPath: string | null;
}

export interface BackupSnapshot {
  id: number;
  snapshotPath: string;
  reason: string;
  byteSize: number;
  createdAt: string;
}

export interface DatabaseRestoreStatus {
  pendingSnapshot: BackupSnapshot | null;
}

export interface DatabaseMaintenanceResult {
  vacuum: boolean;
  pageCountBefore: number;
  pageCountAfter: number;
  freelistCountBefore: number;
  freelistCountAfter: number;
  elapsedMs: number;
}

export interface UpdateStatus {
  currentVersion: string;
  available: boolean;
  latestVersion: string | null;
  notes: string;
}

export interface ReaderProfileRecord {
  id: number;
  profileId: string;
  name: string;
  mode: string;
  direction: string;
  fit: string;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ReaderSettingsScopeCounts {
  bookSettings: number;
  seriesSettings: number;
}

export interface SmartCollectionRecord {
  id: number;
  name: string;
  query: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CacheCleanupResult {
  recordsRemoved: number;
  filesRemoved: number;
}

export interface LibraryRemovalPreview {
  libraryId: number;
  books: number;
  pages: number;
  chapters: number;
  bookmarks: number;
  thumbnailBytes: number;
}

export interface LibraryRemovalResult {
  libraryId: number;
  booksRemoved: number;
  thumbnailFilesRemoved: number;
}

export interface DeletedBookCleanupPreview {
  books: number;
  pages: number;
  chapters: number;
  thumbnails: number;
  thumbnailBytes: number;
}

export interface DeletedBookCleanupResult {
  booksRemoved: number;
  pagesRemoved: number;
  chaptersRemoved: number;
  thumbnailRecordsRemoved: number;
  thumbnailFilesRemoved: number;
}

export interface FeatureFlagRecord {
  key: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LicenseStateRecord {
  status: string;
  licenseKeyPresent: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface TelemetrySettingRecord {
  key: string;
  enabled: boolean;
  value: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface OcrTranslationStatus {
  ocrEnabled: boolean;
  translationEnabled: boolean;
  ocrProviderId: string | null;
  translationProviderId: string | null;
  ocrLocale: string;
  sourceLocale: string;
  targetLocale: string;
  ocrCacheEntries: number;
  translationCacheEntries: number;
}

export interface SyncStatusRecord {
  enabled: boolean;
  providerId: string | null;
  automaticSync: boolean;
  encryptionRequired: boolean;
  conflictStrategy: string;
  configuredProviders: number;
  logEntries: number;
  lastSyncAt: string | null;
}

export interface PluginStatusRecord {
  enabled: boolean;
  manifestCount: number;
  enabledManifestCount: number;
  settingsCount: number;
  dynamicExecutionEnabled: boolean;
  pluginDirectory: string;
  exampleManifestPath: string;
}

export interface LogFileInfo {
  name: string;
  path: string;
  byteSize: number;
  modifiedAt: string | null;
}

export interface BookQuery {
  search?: string;
  sort?: string;
  view?: LibraryView;
  favorite?: boolean;
  author?: string;
  tag?: string;
  category?: string;
  format?: string;
  status?: string;
  minRating?: number;
  duplicatesOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface MetadataUpdate {
  title: string;
  author: string | null;
  volume: number | null;
  chapter: number | null;
}

export interface JmComicSourceCandidate {
  databasePath: string;
  dataDirectory: string;
  downloadCount: number;
  existingSourceCount: number;
  modifiedAt: string | null;
  healthy: boolean;
  message: string | null;
}

export type JmComicMatchStatus = "matched" | "unmatched" | "ambiguous" | "missing_source";

export interface JmComicMatchItem {
  jmId: string;
  sourceTitle: string;
  sourcePath: string;
  logicalRootPath: string;
  sourcePathExists: boolean;
  bookId: number | null;
  currentTitle: string | null;
  status: JmComicMatchStatus;
  matchMethod: "exact_logical_root" | null;
}

export interface JmComicMatchPreview {
  databasePath: string;
  sourceRecords: number;
  matched: number;
  unmatched: number;
  ambiguous: number;
  missingSource: number;
  generatedAt: string;
  previewToken: string;
  readOnly: boolean;
  items: JmComicMatchItem[];
}

export interface ExternalIdentityImportResult {
  linked: number;
  unchanged: number;
  conflicts: number;
  skipped: number;
}

export interface MetadataFieldDiff {
  fieldName: string;
  currentValue: string | null;
  providerValue: string | null;
  manuallyEdited: boolean;
  defaultSelected: boolean;
}

export interface MetadataMergePreview {
  bookId: number;
  providerId: string;
  remoteId: string;
  fields: MetadataFieldDiff[];
  sourceTags: string[];
  cachedAt: string;
}

export interface MetadataJobRecord {
  id: number;
  providerId: string;
  bookId: number;
  remoteId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  requestedBy: string;
  attempts: number;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface JmComicProviderStatus {
  enabled: boolean;
  endpoint: string;
  refreshDays: number;
  requestIntervalMs: number;
  linkedBooks: number;
  cachedBooks: number;
  queuedJobs: number;
  runningJobs: number;
}

export interface ExternalBookIdentity {
  bookId: number;
  providerId: string;
  remoteId: string;
  matchMethod: string;
  matchConfidence: number;
  canonicalSourcePath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalChapterMetadata {
  remoteId: string;
  name: string | null;
  sort: number | null;
}

export interface ExternalBookMetadata {
  bookId: number;
  providerId: string;
  remoteId: string;
  originalTitle: string | null;
  authors: string[];
  categories: string[];
  tags: string[];
  description: string | null;
  chapters: ExternalChapterMetadata[];
  remoteCoverUrl: string | null;
  fetchedAt: string;
  expiresAt: string;
  status: string;
  errorMessage: string | null;
}

export interface JmComicBookSource {
  identity: ExternalBookIdentity;
  metadata: ExternalBookMetadata | null;
  mergePreview: MetadataMergePreview | null;
}

export interface MetadataBatchPreview {
  previewToken: string;
  totalLinked: number;
  eligible: number;
  freshCached: number;
  generatedAt: string;
  force: boolean;
}

export interface MetadataBatchResult {
  requested: number;
  succeeded: number;
  failed: number;
  cancelled: boolean;
}

export interface ReaderSettings {
  mode: ReaderMode;
  direction: ReaderDirection;
  fit: ReaderFit;
  zoom: number;
  background: string;
  brightness: number;
  contrast: number;
  saturation: number;
  rotation: number;
  grayscale: boolean;
  sharpen: boolean;
  trimWhite: boolean;
  coverSingle: boolean;
  preferEnhanced: boolean;
  night: boolean;
  lowMemory: boolean;
  controlsLayout: ReaderControlsLayout;
  sideClickPaging: boolean;
  centerClickControls: boolean;
  doubleClickZoom: boolean;
  doubleClickInterval: 250 | 350 | 500;
  ctrlWheelZoom: boolean;
  wheelPageTurn: boolean;
  dragPan: boolean;
}
