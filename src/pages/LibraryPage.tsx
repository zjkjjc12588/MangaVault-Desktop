import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Dialog from "@radix-ui/react-dialog";
import {
  AlertTriangle,
  Copy,
  Filter,
  FilePlus2,
  FolderOpen,
  Grid2X2,
  Heart,
  Import,
  Layers3,
  List,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Search,
  Star,
  TableProperties,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentPropsWithoutRef,
  type FormEvent,
  type ReactNode,
} from "react";
import { TableVirtuoso, Virtuoso, VirtuosoGrid } from "react-virtuoso";
import { isTauri } from "@tauri-apps/api/core";
import { Button } from "../components/ui/Button";
import { cn } from "../lib/cn";
import { browserDroppedPaths, isFileDrag, normalizeDroppedPaths } from "../lib/dropImport";
import {
  displayPath,
  formatBytes,
  formatDateTime,
  formatNumber,
  formatPercent,
} from "../lib/format";
import { formatUserError, t } from "../lib/i18n";
import { getLayoutSettings, subscribeLayoutSettings, type LayoutSettings } from "../lib/navigation";
import { groupBooksBySeries } from "../lib/series";
import type {
  Book,
  BookQuery,
  LibraryView,
  MetadataUpdate,
  JmComicBookSource,
  ScanFailure,
  ScanJob,
} from "../lib/types";
import * as api from "../lib/api";
import { listScanFailures, openPathInShell } from "../lib/api";
import { getCachedThumbnailDataUrl } from "../lib/thumbnailCache";
import {
  useBookActivation,
  type BookActivationApi,
  type BookActivationBindings,
} from "../library/useBookActivation";
import { useLibraryStore } from "../stores/libraryStore";
import { useToastStore } from "../stores/toastStore";

interface LibraryPageProps {
  onOpenReader: () => void;
}

export function LibraryPage({ onOpenReader }: LibraryPageProps) {
  const layout = useSyncExternalStore(
    subscribeLayoutSettings,
    getLayoutSettings,
    getLayoutSettings,
  );
  const {
    books,
    loading,
    loadingMore,
    hasMore,
    error,
    query,
    view,
    jobs,
    authors,
    formats,
    load,
    loadMore,
    setQuery,
    setView,
    importFolder,
    importFiles,
    importPaths,
    toggleFavorite,
    setRating,
    tags,
    categories,
    updateMetadata,
    setTags,
    refreshJobs,
    cancelScan,
    retryScan,
  } = useLibraryStore();
  const activation = useBookActivation(onOpenReader);
  const pushToast = useToastStore((state) => state.push);
  const [editing, setEditing] = useState<Book | null>(null);
  const [failureJob, setFailureJob] = useState<ScanJob | null>(null);
  const [searchText, setSearchText] = useState(query.search ?? "");
  const [draggingImport, setDraggingImport] = useState(false);
  const dragDepth = useRef(0);
  const activeJobs = useMemo(() => jobs.filter(isActiveScan), [jobs]);
  const hasActiveFilters = libraryQueryHasFilters(query);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSearchText(query.search ?? "");
  }, [query.search]);

  useEffect(() => {
    const next = searchText.trim();
    const current = query.search ?? "";
    if (next === current) return;
    const timer = window.setTimeout(() => {
      void setQuery({ search: next || undefined });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [query.search, searchText, setQuery]);

  useEffect(() => {
    if (!jobs.some((job) => ["queued", "running", "cancelling"].includes(job.status))) return;
    const timer = window.setInterval(() => void refreshJobs(), 1200);
    return () => window.clearInterval(timer);
  }, [jobs, refreshJobs]);

  useEffect(() => {
    const onDrop = (event: DragEvent) => {
      if (isTauri()) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDraggingImport(false);
      const paths = browserDroppedPaths(Array.from(event.dataTransfer?.files ?? []));
      if (paths.length > 0) void importPaths(paths);
    };
    const onDragEnter = (event: DragEvent) => {
      if (isTauri()) return;
      event.preventDefault();
      if (!isFileDrag(Array.from(event.dataTransfer?.types ?? []))) return;
      dragDepth.current += 1;
      setDraggingImport(true);
    };
    const onDragLeave = (event: DragEvent) => {
      if (isTauri()) return;
      event.preventDefault();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDraggingImport(false);
    };
    const onDragOver = (event: DragEvent) => {
      if (isTauri()) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    return () => {
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
    };
  }, [importPaths]);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const registerNativeDrop = async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const nextUnlisten = await getCurrentWindow().onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          setDraggingImport(true);
          return;
        }
        if (payload.type === "leave") {
          setDraggingImport(false);
          return;
        }
        setDraggingImport(false);
        const paths = normalizeDroppedPaths(payload.paths);
        if (paths.length > 0) void importPaths(paths);
      });
      if (disposed) {
        nextUnlisten();
      } else {
        unlisten = nextUnlisten;
      }
    };
    void registerNativeDrop().catch(() => setDraggingImport(false));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [importPaths]);

  const openLocalPath = async (book: Book) => {
    try {
      await openPathInShell(book.path);
    } catch (err) {
      pushToast({
        title: t("pathOpenFailed"),
        description: formatUserError(err),
        tone: "error",
      });
    }
  };
  const clearFilters = () => {
    setSearchText("");
    void setQuery({
      search: undefined,
      tag: undefined,
      category: undefined,
      author: undefined,
      format: undefined,
      status: undefined,
      minRating: undefined,
      favorite: undefined,
      duplicatesOnly: undefined,
    });
  };

  return (
    <section className="relative flex h-full min-w-0 flex-1 flex-col bg-background">
      <header className="flex h-16 items-center gap-3 border-b border-border bg-panel px-5">
        <div className="relative max-w-xl flex-1">
          <Search
            size={17}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground/50"
          />
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder={t("search")}
            className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm"
          />
        </div>
        <select
          className="h-10 rounded-md border border-border bg-panelMuted px-3 text-sm"
          value={query.sort ?? "title"}
          onChange={(event) => void setQuery({ sort: event.target.value })}
        >
          <option value="title">{t("sortTitle")}</option>
          <option value="author">{t("sortAuthor")}</option>
          <option value="recent">{t("sortRecent")}</option>
          <option value="imported">{t("sortImported")}</option>
          <option value="progress">{t("sortProgress")}</option>
          <option value="rating">{t("sortRating")}</option>
        </select>
        <select
          aria-label={t("sourceCategory")}
          className="h-8 max-w-48 rounded-md border border-border bg-panelMuted px-2 text-xs"
          value={query.category ?? ""}
          onChange={(event) => void setQuery({ category: event.target.value || undefined })}
        >
          <option value="">{t("allSourceCategories")}</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
        <ViewButton
          view="grid"
          current={view}
          onClick={(nextView) => void setView(nextView)}
          icon={<Grid2X2 size={17} />}
        />
        <ViewButton
          view="list"
          current={view}
          onClick={(nextView) => void setView(nextView)}
          icon={<List size={17} />}
        />
        <ViewButton
          view="wall"
          current={view}
          onClick={(nextView) => void setView(nextView)}
          icon={<TableProperties size={17} />}
        />
        <ViewButton
          view="series"
          current={view}
          onClick={(nextView) => void setView(nextView)}
          icon={<Layers3 size={17} />}
        />
        <Button variant="primary" onClick={() => void importFolder()}>
          <Import size={17} />
          {t("import")}
        </Button>
        <Button variant="subtle" onClick={() => void importFiles()}>
          <FilePlus2 size={17} />
          {t("importFile")}
        </Button>
      </header>

      {error && (
        <div className="border-b border-danger/50 bg-danger/15 px-5 py-2 text-sm">{error}</div>
      )}

      <div className="flex h-12 items-center gap-2 border-b border-border bg-panel/55 px-5">
        <Filter size={16} className="text-foreground/50" />
        <select
          className="h-8 rounded-md border border-border bg-panelMuted px-2 text-xs"
          value={query.tag ?? ""}
          onChange={(event) => void setQuery({ tag: event.target.value || undefined })}
        >
          <option value="">{t("allTags")}</option>
          {tags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
        <select
          className="h-8 max-w-48 rounded-md border border-border bg-panelMuted px-2 text-xs"
          value={query.author ?? ""}
          onChange={(event) => void setQuery({ author: event.target.value || undefined })}
        >
          <option value="">{t("allAuthors")}</option>
          {authors.map((author) => (
            <option key={author} value={author}>
              {author}
            </option>
          ))}
        </select>
        <select
          className="h-8 rounded-md border border-border bg-panelMuted px-2 text-xs"
          value={query.format ?? ""}
          onChange={(event) => void setQuery({ format: event.target.value || undefined })}
        >
          <option value="">{t("allFormats")}</option>
          {formats.map((format) => (
            <option key={format} value={format}>
              {format.toUpperCase()}
            </option>
          ))}
        </select>
        <select
          aria-label={t("bookStatus")}
          className="h-8 rounded-md border border-border bg-panelMuted px-2 text-xs"
          value={query.status ?? ""}
          onChange={(event) => void setQuery({ status: event.target.value || undefined })}
        >
          <option value="">{t("allStatuses")}</option>
          <option value="available">{t("statusAvailable")}</option>
          <option value="missing">{t("statusMissing")}</option>
          <option value="deleted">{t("statusDeleted")}</option>
        </select>
        <select
          className="h-8 rounded-md border border-border bg-panelMuted px-2 text-xs"
          value={query.minRating ?? ""}
          onChange={(event) =>
            void setQuery({
              minRating: event.target.value ? Number(event.target.value) : undefined,
            })
          }
        >
          <option value="">{t("anyRating")}</option>
          <option value="1">1+ {t("ratingAtLeast")}</option>
          <option value="2">2+ {t("ratingAtLeast")}</option>
          <option value="3">3+ {t("ratingAtLeast")}</option>
          <option value="4">4+ {t("ratingAtLeast")}</option>
          <option value="5">{t("fiveStars")}</option>
        </select>
        <Button
          size="sm"
          variant={query.favorite ? "primary" : "subtle"}
          onClick={() => void setQuery({ favorite: query.favorite ? undefined : true })}
        >
          <Heart size={15} />
          {t("favorites")}
        </Button>
        <Button
          size="sm"
          variant={query.duplicatesOnly ? "primary" : "subtle"}
          onClick={() => void setQuery({ duplicatesOnly: query.duplicatesOnly ? undefined : true })}
        >
          <Copy size={15} />
          {t("duplicates")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void setQuery({
              tag: undefined,
              category: undefined,
              author: undefined,
              format: undefined,
              status: undefined,
              minRating: undefined,
              favorite: undefined,
              duplicatesOnly: undefined,
            })
          }
        >
          <X size={15} />
          {t("clear")}
        </Button>
      </div>

      <div className="flex h-10 items-center gap-4 border-b border-border px-5 text-xs text-foreground/60">
        <span>{t("loadedBooks").replace("{count}", String(books.length))}</span>
        {hasMore && <span>{loadingMore ? t("loadingMore") : t("scrollForMore")}</span>}
        {jobs.slice(0, 3).map((job) => (
          <span key={job.id} className="flex min-w-44 items-center gap-2">
            <span className="whitespace-nowrap">
              {scanStatusLabel(job.status, job.message)}: {job.importedCount}/{job.discoveredCount}
            </span>
            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-panelMuted">
              <span
                className="block h-full rounded-full bg-accent transition-[width]"
                style={{ width: scanProgressPercent(job) }}
              />
            </span>
            {isActiveScan(job) && (
              <button
                className="rounded border border-border px-2 py-0.5 text-[11px] enabled:hover:bg-panelMuted disabled:opacity-60"
                disabled={job.status === "cancelling"}
                onClick={() => void cancelScan(job.id)}
              >
                {job.status === "cancelling" ? t("scanCancelPending") : t("cancel")}
              </button>
            )}
            {isRetryableScan(job) && (
              <button
                className="rounded border border-border px-2 py-0.5 text-[11px] hover:bg-panelMuted"
                onClick={() => void retryScan(job.id)}
              >
                {t("retry")}
              </button>
            )}
            {job.failedCount > 0 && (
              <button
                className="rounded border border-danger/50 px-2 py-0.5 text-[11px] text-danger hover:bg-danger/10"
                onClick={() => setFailureJob(job)}
              >
                <AlertTriangle className="mr-1 inline-block" size={12} />
                {t("scanFailureDetails")}
              </button>
            )}
          </span>
        ))}
      </div>

      {loading && books.length === 0 ? (
        <SkeletonGrid layout={layout} />
      ) : books.length === 0 && activeJobs.length > 0 && !hasActiveFilters ? (
        <ScanningState
          jobs={activeJobs}
          layout={layout}
          onCancel={(jobId) => void cancelScan(jobId)}
        />
      ) : books.length === 0 && hasActiveFilters ? (
        <NoResultsState onClear={clearFilters} />
      ) : books.length === 0 ? (
        <EmptyState onImport={() => void importFolder()} />
      ) : view === "list" ? (
        <BookList
          books={books}
          activation={activation}
          onFavorite={toggleFavorite}
          onRating={setRating}
          onEdit={setEditing}
          onOpenPath={openLocalPath}
          onEndReached={loadMore}
        />
      ) : view === "series" ? (
        <SeriesView books={books} activation={activation} onEndReached={loadMore} />
      ) : (
        <VirtuosoGrid
          className="thin-scrollbar flex-1"
          totalCount={books.length}
          itemContent={(index) => {
            const book = books[index];
            return book ? (
              <BookCard
                book={book}
                wall={view === "wall"}
                coverAspectRatio={layout.coverAspectRatio}
                activation={activation}
                onFavorite={toggleFavorite}
                onRating={setRating}
                onEdit={setEditing}
                onOpenPath={openLocalPath}
              />
            ) : null;
          }}
          listClassName={`virtuoso-grid-list grid-density-${layout.gridDensity}`}
          itemClassName="virtuoso-grid-item"
          rangeChanged={({ endIndex }) => {
            if (endIndex >= books.length - 24) void loadMore();
          }}
        />
      )}
      <MetadataDialog
        book={editing}
        onOpenChange={(open) => !open && setEditing(null)}
        onSave={async (book, update, tagList) => {
          await updateMetadata(book.id, update);
          await setTags(book.id, tagList);
          setEditing(null);
        }}
      />
      <ScanFailureDialog job={failureJob} onOpenChange={(open) => !open && setFailureJob(null)} />
      {draggingImport && <DropImportOverlay />}
    </section>
  );
}

function ScanFailureDialog({
  job,
  onOpenChange,
}: {
  job: ScanJob | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [failures, setFailures] = useState<ScanFailure[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!job) {
      setFailures([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setFailures([]);
    setError(null);
    void listScanFailures(job.id)
      .then((next) => {
        if (!cancelled) setFailures(next);
      })
      .catch((nextError) => {
        if (!cancelled) setError(formatUserError(nextError));
      });
    return () => {
      cancelled = true;
    };
  }, [job]);

  return (
    <Dialog.Root open={Boolean(job)} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/55" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[78vh] w-[640px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-panel p-5 shadow-2xl">
          <Dialog.Title className="text-base font-semibold">{t("scanFailureDetails")}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-foreground/55">
            {job?.rootPath ? displayPath(job.rootPath) : ""}
          </Dialog.Description>
          <div className="thin-scrollbar mt-4 min-h-0 space-y-2 overflow-auto pr-1">
            {error && (
              <div className="rounded-md bg-danger/15 p-3 text-sm text-danger">{error}</div>
            )}
            {!error && failures.length === 0 && (
              <div className="rounded-md border border-border bg-panelMuted p-3 text-sm text-foreground/60">
                {t("scanFailureEmpty")}
              </div>
            )}
            {failures.map((failure) => (
              <div
                key={failure.id}
                className="rounded-md border border-border bg-panelMuted p-3 text-sm"
              >
                <div className="text-xs font-medium text-danger">
                  {scanFailureStageLabel(failure.stage)}
                </div>
                {failure.path && (
                  <div className="mt-1 break-all text-xs text-foreground/60">
                    {failure.path ? displayPath(failure.path) : ""}
                  </div>
                )}
                <div className="mt-2 break-words text-foreground/80">{failure.message}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function scanFailureStageLabel(stage: string): string {
  if (stage === "discovery") return t("scanFailureDiscovery");
  if (stage === "database") return t("scanFailureDatabase");
  return t("scanFailureIndex");
}

function DropImportOverlay() {
  return (
    <div className="pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-background/80 backdrop-blur">
      <div className="text-center">
        <div className="text-lg font-semibold text-foreground">{t("dropToImportTitle")}</div>
        <div className="mt-2 text-sm text-foreground/65">{t("dropToImportBody")}</div>
      </div>
    </div>
  );
}

function SeriesView({
  books,
  activation,
  onEndReached,
}: {
  books: Book[];
  activation: BookActivationApi;
  onEndReached: () => Promise<void>;
}) {
  const groups = useMemo(() => groupBooksBySeries(books), [books]);
  return (
    <Virtuoso
      className="thin-scrollbar flex-1"
      totalCount={groups.length}
      computeItemKey={(index) => groups[index]?.key ?? index}
      rangeChanged={({ endIndex }) => {
        if (endIndex >= groups.length - 8) void onEndReached();
      }}
      itemContent={(index) => {
        const group = groups[index];
        return group ? (
          <div className="px-5 pb-4 first:pt-5">
            <SeriesCard group={group} activation={activation} />
          </div>
        ) : null;
      }}
    />
  );
}

type SeriesGroup = ReturnType<typeof groupBooksBySeries>[number];

function SeriesCard({ group, activation }: { group: SeriesGroup; activation: BookActivationApi }) {
  return (
    <div className="rounded-md border border-border bg-panel p-4">
      <div className="grid grid-cols-[92px_1fr] gap-4">
        <div className="aspect-[2/3] overflow-hidden rounded-md border border-border bg-panelMuted">
          <CoverImage book={group.books[0]} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-base font-semibold">{group.title}</div>
          <div className="mt-1 text-xs text-foreground/55">
            {group.author ?? t("unknownAuthor")} · {group.books.length} {t("titleCount")} ·{" "}
            {group.pageCount} {t("pages")}
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-panelMuted">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${Math.round(group.progressPercent * 100)}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-foreground/50">
            {formatPercent(group.progressPercent)} {t("read")}
          </div>
          <div className="mt-3 max-h-44 overflow-auto pr-1">
            {group.books.map((book) => (
              <div
                key={book.id}
                role="option"
                {...activation.bindingsFor(book)}
                className={cn(
                  "grid w-full grid-cols-[1fr_auto] gap-3 rounded px-2 py-1.5 text-left text-sm hover:bg-panelMuted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                  activation.selectedBookId === book.id &&
                    "bg-accent/18 ring-1 ring-inset ring-accent",
                  activation.openingBookId === book.id && "opacity-70",
                )}
              >
                <span className="truncate">
                  {seriesBookLabel(book)} · {book.title}
                </span>
                <span className="text-xs text-foreground/50">
                  {formatPercent(book.progressPercent)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function seriesBookLabel(book: Book): string {
  const parts = [];
  if (book.volume !== null) parts.push(`${t("volumeShort")} ${book.volume}`);
  if (book.chapter !== null) parts.push(`${t("chapterShort")} ${book.chapter}`);
  return parts.length > 0 ? parts.join(" ") : book.format.toUpperCase();
}

function ViewButton({
  view,
  current,
  onClick,
  icon,
}: {
  view: LibraryView;
  current: LibraryView;
  onClick: (view: LibraryView) => void;
  icon: ReactNode;
}) {
  return (
    <Button
      title={viewLabel(view)}
      size="icon"
      variant={current === view ? "primary" : "subtle"}
      onClick={() => onClick(view)}
    >
      {icon}
    </Button>
  );
}

function BookCard({
  book,
  wall,
  coverAspectRatio,
  activation,
  onFavorite,
  onRating,
  onEdit,
  onOpenPath,
}: {
  book: Book;
  wall: boolean;
  coverAspectRatio: LayoutSettings["coverAspectRatio"];
  activation: BookActivationApi;
  onFavorite: (id: number) => Promise<void>;
  onRating: (id: number, rating: number) => Promise<void>;
  onEdit: (book: Book) => void;
  onOpenPath: (book: Book) => Promise<void>;
}) {
  return (
    <BookContextMenu
      book={book}
      onOpen={activation.activateBook}
      onFavorite={onFavorite}
      onRating={onRating}
      onEdit={onEdit}
      onOpenPath={onOpenPath}
    >
      <div
        role="option"
        {...activation.bindingsFor(book)}
        className={cn(
          "group block w-full rounded-md text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          activation.selectedBookId === book.id &&
            "ring-2 ring-accent ring-offset-2 ring-offset-background",
          activation.openingBookId === book.id && "opacity-70",
        )}
      >
        <div
          data-testid="book-cover"
          data-cover-ratio={coverAspectRatio}
          className={`${coverAspectClass(coverAspectRatio)} overflow-hidden rounded-md border border-border ${
            wall ? "bg-panelMuted" : "bg-panel"
          }`}
        >
          <CoverImage book={book} />
        </div>
        {!wall && (
          <div className="mt-2 min-w-0">
            <div className="truncate text-sm font-medium">{book.title}</div>
            <div className="mt-1 flex items-center justify-between text-xs text-foreground/55">
              <span>
                {book.pageCount} {t("pages")}
              </span>
              <span>{formatPercent(book.progressPercent)}</span>
            </div>
          </div>
        )}
      </div>
    </BookContextMenu>
  );
}

function BookContextMenu({
  book,
  children,
  onOpen,
  onFavorite,
  onRating,
  onEdit,
  onOpenPath,
}: {
  book: Book;
  children: ReactNode;
  onOpen: (book: Book) => void;
  onFavorite: (id: number) => Promise<void>;
  onRating: (id: number, rating: number) => Promise<void>;
  onEdit: (book: Book) => void;
  onOpenPath: (book: Book) => Promise<void>;
}) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-44 rounded-md border border-border bg-panel p-1 shadow-xl">
          <MenuItem onSelect={() => void onOpen(book)}>{t("open")}</MenuItem>
          <MenuItem onSelect={() => void onFavorite(book.id)}>
            {book.isFavorite ? t("unfavorite") : t("favorite")}
          </MenuItem>
          <MenuItem onSelect={() => void onRating(book.id, Math.min(5, book.rating + 1))}>
            {t("increaseRating")}
          </MenuItem>
          <MenuItem onSelect={() => onEdit(book)}>{t("editMetadata")}</MenuItem>
          <MenuItem onSelect={() => void onOpenPath(book)}>{t("openLocalPath")}</MenuItem>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function CoverImage({ book }: { book: Book }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    if (book.pageCount <= 0) {
      setFailed(true);
      return;
    }
    setSrc(null);
    setFailed(false);
    void getCachedThumbnailDataUrl(book.id, book.coverPageIndex, {
      signal: controller.signal,
      priority: "visible",
    })
      .then((dataUrl) => {
        if (!controller.signal.aborted) setSrc(dataUrl);
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error && error.name === "AbortError")) setFailed(true);
      });
    return () => {
      controller.abort();
    };
  }, [book.id, book.coverPageIndex, book.pageCount, book.format]);

  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="h-full w-full object-cover"
        loading="lazy"
        draggable={false}
      />
    );
  }
  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-panelMuted to-background p-3 text-center text-sm font-semibold text-foreground/70">
      {failed ? book.title : ""}
    </div>
  );
}

function MetadataDialog({
  book,
  onOpenChange,
  onSave,
}: {
  book: Book | null;
  onOpenChange: (open: boolean) => void;
  onSave: (book: Book, update: MetadataUpdate, tags: string[]) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [volume, setVolume] = useState("");
  const [chapter, setChapter] = useState("");
  const [tagText, setTagText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [source, setSource] = useState<JmComicBookSource | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);

  useEffect(() => {
    if (!book) return;
    setTitle(book.title);
    setAuthor(book.author ?? "");
    setVolume(book.volume?.toString() ?? "");
    setChapter(book.chapter?.toString() ?? "");
    setTagText(book.tags.join(", "));
    setSaveError(null);
    setSource(null);
    setSourceError(null);
    let cancelled = false;
    setSourceLoading(true);
    void api
      .getJmComicBookSource(book.id)
      .then((value) => {
        if (!cancelled) setSource(value);
      })
      .catch((error) => {
        if (!cancelled) setSourceError(formatUserError(error));
      })
      .finally(() => {
        if (!cancelled) setSourceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [book]);

  const refreshSource = async () => {
    if (!book) return;
    setSourceLoading(true);
    setSourceError(null);
    try {
      await api.refreshJmComicMetadata(book.id, true);
      setSource(await api.getJmComicBookSource(book.id));
    } catch (error) {
      setSourceError(formatUserError(error));
    } finally {
      setSourceLoading(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!book || !title.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(
        book,
        {
          title: title.trim(),
          author: author.trim() || null,
          volume: volume.trim() ? Number(volume) : null,
          chapter: chapter.trim() ? Number(chapter) : null,
        },
        tagText
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      );
    } catch (err) {
      setSaveError(formatUserError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open={Boolean(book)} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/55" />
        <Dialog.Content className="thin-scrollbar fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[min(680px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-panel p-5 shadow-2xl">
          <Dialog.Title className="text-base font-semibold">{t("editMetadata")}</Dialog.Title>
          <form className="mt-4 space-y-3" onSubmit={(event) => void submit(event)}>
            {saveError && (
              <div
                role="alert"
                className="rounded-md border border-danger/60 bg-danger/15 px-3 py-2 text-sm text-danger"
              >
                {t("metadataSaveFailed")}: {saveError}
              </div>
            )}
            <Field label={t("title")}>
              <input
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
            </Field>
            <Field label={t("author")}>
              <input
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                value={author}
                onChange={(event) => setAuthor(event.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("volume")}>
                <input
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                  value={volume}
                  type="number"
                  step="0.1"
                  onChange={(event) => setVolume(event.target.value)}
                />
              </Field>
              <Field label={t("chapter")}>
                <input
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                  value={chapter}
                  type="number"
                  step="0.1"
                  onChange={(event) => setChapter(event.target.value)}
                />
              </Field>
            </div>
            <Field label={t("tags")}>
              <input
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                value={tagText}
                onChange={(event) => setTagText(event.target.value)}
                placeholder={t("metadataTagPlaceholder")}
              />
            </Field>
            <section
              className="border border-border bg-background p-3"
              aria-label={t("sourceInfo")}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">{t("jmComicSource")}</div>
                  <div className="mt-0.5 text-xs text-foreground/50">
                    {source
                      ? `JM ${source.identity.remoteId} · ${t("exactPathMatch")}`
                      : sourceLoading
                        ? t("loadingSourceInfo")
                        : t("noJmSource")}
                  </div>
                </div>
                {source && (
                  <Button
                    type="button"
                    size="sm"
                    variant="subtle"
                    disabled={sourceLoading}
                    onClick={() => void refreshSource()}
                  >
                    <RefreshCw size={15} className={sourceLoading ? "animate-spin" : undefined} />
                    {t("refreshSourceMetadata")}
                  </Button>
                )}
              </div>
              {sourceError && (
                <div className="mt-2 text-xs text-danger" role="alert">
                  {sourceError}
                </div>
              )}
              {source?.metadata && (
                <div className="mt-3 space-y-3 border-t border-border pt-3 text-xs">
                  {source.metadata.originalTitle && (
                    <SourceField label={t("sourceTitle")}>
                      <span>{source.metadata.originalTitle}</span>
                      <button
                        type="button"
                        className="text-accent hover:underline"
                        onClick={() => setTitle(source.metadata?.originalTitle ?? title)}
                      >
                        {t("useThisValue")}
                      </button>
                    </SourceField>
                  )}
                  {source.metadata.authors.length > 0 && (
                    <SourceField label={t("sourceAuthor")}>
                      <span>{source.metadata.authors.join(", ")}</span>
                      <button
                        type="button"
                        className="text-accent hover:underline"
                        onClick={() => setAuthor(source.metadata?.authors.join(", ") ?? author)}
                      >
                        {t("useThisValue")}
                      </button>
                    </SourceField>
                  )}
                  <SourceChips label={t("sourceTags")} values={source.metadata.tags} />
                  <SourceChips label={t("sourceCategories")} values={source.metadata.categories} />
                  {source.metadata.description && (
                    <div>
                      <div className="font-medium text-foreground/55">{t("sourceDescription")}</div>
                      <p className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-foreground/75">
                        {source.metadata.description}
                      </p>
                    </div>
                  )}
                  <div className="text-foreground/45">
                    {t("sourceUpdatedAt")}: {formatDateTime(source.metadata.fetchedAt)}
                  </div>
                </div>
              )}
            </section>
            <div className="truncate rounded-md bg-background px-3 py-2 text-xs text-foreground/55">
              {book?.path ? displayPath(book.path) : ""}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost">
                  {t("cancel")}
                </Button>
              </Dialog.Close>
              <Button type="submit" variant="primary" disabled={saving}>
                <Pencil size={16} />
                {t("save")}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-foreground/60">{label}</span>
      {children}
    </label>
  );
}

function SourceField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)_auto] items-start gap-3">
      <span className="text-foreground/50">{label}</span>
      {children}
    </div>
  );
}

function SourceChips({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3">
      <span className="text-foreground/50">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {values.map((value) => (
          <span key={value} className="rounded border border-border bg-panelMuted px-2 py-0.5">
            {value}
          </span>
        ))}
      </div>
    </div>
  );
}

function BookList({
  books,
  activation,
  onFavorite,
  onRating,
  onEdit,
  onOpenPath,
  onEndReached,
}: {
  books: Book[];
  activation: BookActivationApi;
  onFavorite: (id: number) => Promise<void>;
  onRating: (id: number, rating: number) => Promise<void>;
  onEdit: (book: Book) => void;
  onOpenPath: (book: Book) => Promise<void>;
  onEndReached: () => Promise<void>;
}) {
  return (
    <TableVirtuoso
      className="thin-scrollbar flex-1"
      data={books}
      components={virtualTableComponents}
      rangeChanged={({ endIndex }) => {
        if (endIndex >= books.length - 30) void onEndReached();
      }}
      fixedHeaderContent={() => (
        <tr>
          <th className="w-[34%] px-5 py-3">{t("title")}</th>
          <th className="w-[16%] px-3 py-3">{t("author")}</th>
          <th className="w-[10%] px-3 py-3">{t("format")}</th>
          <th className="w-[10%] px-3 py-3">{t("pages")}</th>
          <th className="w-[12%] px-3 py-3">{t("size")}</th>
          <th className="w-[10%] px-3 py-3">{t("progress")}</th>
          <th className="w-[8%] px-3 py-3">{t("actions")}</th>
        </tr>
      )}
      itemContent={(_, book) => (
        <BookListCells
          book={book}
          activation={activation}
          onFavorite={onFavorite}
          onRating={onRating}
          onEdit={onEdit}
          onOpenPath={onOpenPath}
        />
      )}
    />
  );
}

const virtualTableComponents = {
  Table: ({ style, ...props }: ComponentPropsWithoutRef<"table">) => (
    <table
      {...props}
      style={{ ...style, tableLayout: "fixed", borderCollapse: "separate", borderSpacing: 0 }}
      className="w-full text-sm"
    />
  ),
  TableHead: (props: ComponentPropsWithoutRef<"thead">) => (
    <thead
      {...props}
      className="bg-panel text-left text-xs uppercase tracking-wide text-foreground/55"
    />
  ),
  TableRow: (props: ComponentPropsWithoutRef<"tr">) => (
    <tr {...props} className="cursor-default border-b border-border/65 hover:bg-panelMuted" />
  ),
};

function BookListCells({
  book,
  activation,
  onFavorite,
  onRating,
  onEdit,
  onOpenPath,
}: {
  book: Book;
  activation: BookActivationApi;
  onFavorite: (id: number) => Promise<void>;
  onRating: (id: number, rating: number) => Promise<void>;
  onEdit: (book: Book) => void;
  onOpenPath: (book: Book) => Promise<void>;
}) {
  const contextMenuProps = {
    book,
    onOpen: activation.activateBook,
    onFavorite,
    onRating,
    onEdit,
    onOpenPath,
  };
  const selected = activation.selectedBookId === book.id;
  const cellClass = selected ? "bg-accent/14 ring-1 ring-inset ring-accent/55" : undefined;
  return (
    <>
      <BookListCell
        {...contextMenuProps}
        bindings={activation.bindingsFor(book)}
        className={cn("truncate border-b border-border/65 px-5 py-3", cellClass)}
      >
        <button
          data-book-action
          className="mr-2 text-foreground/65 hover:text-foreground"
          onClick={() => void onFavorite(book.id)}
          title={book.isFavorite ? t("unfavorite") : t("favorite")}
        >
          <Heart size={15} fill={book.isFavorite ? "currentColor" : "none"} />
        </button>
        {book.title}
      </BookListCell>
      <BookListCell
        {...contextMenuProps}
        bindings={activation.bindingsFor(book, false)}
        className={cn("truncate border-b border-border/65 px-3 py-3 text-foreground/70", cellClass)}
      >
        {book.author ?? t("unknown")}
      </BookListCell>
      <BookListCell
        {...contextMenuProps}
        bindings={activation.bindingsFor(book, false)}
        className={cn(
          "border-b border-border/65 px-3 py-3 uppercase text-foreground/70",
          cellClass,
        )}
      >
        {book.format}
      </BookListCell>
      <BookListCell
        {...contextMenuProps}
        bindings={activation.bindingsFor(book, false)}
        className={cn("border-b border-border/65 px-3 py-3 text-foreground/70", cellClass)}
      >
        {book.pageCount}
      </BookListCell>
      <BookListCell
        {...contextMenuProps}
        bindings={activation.bindingsFor(book, false)}
        className={cn("border-b border-border/65 px-3 py-3 text-foreground/70", cellClass)}
      >
        {formatBytes(book.fileSize)}
      </BookListCell>
      <BookListCell
        {...contextMenuProps}
        bindings={activation.bindingsFor(book, false)}
        className={cn("border-b border-border/65 px-3 py-3 text-foreground/70", cellClass)}
      >
        {formatPercent(book.progressPercent)}
      </BookListCell>
      <BookListCell
        {...contextMenuProps}
        bindings={activation.bindingsFor(book, false)}
        className={cn("border-b border-border/65 px-3 py-3", cellClass)}
      >
        <button
          data-book-action
          className="mr-3"
          onClick={() => void onRating(book.id, book.rating === 5 ? 0 : book.rating + 1)}
          title={t("rating")}
        >
          <Star size={15} fill={book.rating > 0 ? "currentColor" : "none"} />
        </button>
        <button data-book-action onClick={() => onEdit(book)} title={t("editMetadata")}>
          <Pencil size={15} />
        </button>
        <button
          data-book-action
          className="ml-3 text-foreground/65 hover:text-foreground"
          onClick={() => void onOpenPath(book)}
          title={t("openLocalPath")}
        >
          <FolderOpen size={15} />
        </button>
      </BookListCell>
    </>
  );
}

function BookListCell({
  book,
  children,
  className,
  bindings,
  onOpen,
  onFavorite,
  onRating,
  onEdit,
  onOpenPath,
}: {
  book: Book;
  children: ReactNode;
  className?: string;
  bindings: BookActivationBindings;
  onOpen: (book: Book) => void;
  onFavorite: (id: number) => Promise<void>;
  onRating: (id: number, rating: number) => Promise<void>;
  onEdit: (book: Book) => void;
  onOpenPath: (book: Book) => Promise<void>;
}) {
  return (
    <BookContextMenu
      book={book}
      onOpen={onOpen}
      onFavorite={onFavorite}
      onRating={onRating}
      onEdit={onEdit}
      onOpenPath={onOpenPath}
    >
      <td
        {...bindings}
        className={cn(
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
          className,
        )}
      >
        {children}
      </td>
    </BookContextMenu>
  );
}

function MenuItem({ children, onSelect }: { children: ReactNode; onSelect: () => void }) {
  return (
    <ContextMenu.Item
      onSelect={onSelect}
      className="cursor-default rounded px-3 py-2 text-sm outline-none hover:bg-panelMuted"
    >
      {children}
    </ContextMenu.Item>
  );
}

function viewLabel(view: LibraryView): string {
  if (view === "grid") return t("grid");
  if (view === "list") return t("list");
  if (view === "wall") return t("wall");
  return t("series");
}

function scanStatusLabel(status: string, message?: string | null): string {
  if (status === "queued") return t("scanQueued");
  if (status === "running" && message === "discovering") return t("scanDiscovering");
  if (status === "running") return t("scanRunning");
  if (status === "cancelling") return t("scanCancelling");
  if (status === "complete") return t("scanComplete");
  if (status === "cancelled") return t("scanCancelled");
  if (status === "interrupted") return t("scanInterrupted");
  if (status === "failed") return t("scanFailed");
  return t("scan");
}

function isActiveScan(job: ScanJob): boolean {
  return ["queued", "running", "cancelling"].includes(job.status);
}

function isRetryableScan(job: ScanJob): boolean {
  return ["failed", "cancelled", "interrupted"].includes(job.status);
}

function libraryQueryHasFilters(query: BookQuery): boolean {
  return Boolean(
    query.search ||
    query.tag ||
    query.author ||
    query.format ||
    query.status ||
    query.minRating ||
    query.favorite ||
    query.duplicatesOnly,
  );
}

function scanProgressPercent(job: {
  discoveredCount: number;
  importedCount: number;
  failedCount: number;
}): string {
  return `${scanProgressValue(job)}%`;
}

function scanProgressValue(job: {
  discoveredCount: number;
  importedCount: number;
  failedCount: number;
}): number {
  if (job.discoveredCount <= 0) return 8;
  const completed = Math.min(job.discoveredCount, job.importedCount + job.failedCount);
  return Math.max(6, Math.round((completed / job.discoveredCount) * 100));
}

function EmptyState({ onImport }: { onImport: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center p-10">
      <div className="max-w-md text-center">
        <div className="text-xl font-semibold">{t("newUserEmptyTitle")}</div>
        <p className="mt-2 text-sm leading-6 text-foreground/60">{t("newUserEmptyBody")}</p>
        <Button className="mt-5" variant="primary" onClick={onImport}>
          <Import size={17} />
          {t("addMangaFolder")}
        </Button>
      </div>
    </div>
  );
}

function NoResultsState({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center p-10">
      <div className="max-w-md text-center">
        <Search size={28} className="mx-auto text-foreground/45" />
        <div className="mt-4 text-xl font-semibold">{t("noResultsTitle")}</div>
        <p className="mt-2 text-sm leading-6 text-foreground/60">{t("noResultsBody")}</p>
        <Button className="mt-5" variant="subtle" onClick={onClear}>
          <X size={17} />
          {t("clearFilters")}
        </Button>
      </div>
    </div>
  );
}

function ScanningState({
  jobs,
  layout,
  onCancel,
}: {
  jobs: ScanJob[];
  layout: LayoutSettings;
  onCancel: (jobId: number) => void;
}) {
  return (
    <div className="thin-scrollbar flex-1 overflow-y-auto px-5 py-8" data-testid="scanning-state">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-start gap-4">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-md bg-accent/15 text-accent">
            <LoaderCircle size={24} className="animate-spin" />
          </div>
          <div className="min-w-0">
            <h2 className="m-0 text-xl font-semibold">{t("scanInProgressTitle")}</h2>
            <p className="mt-1 text-sm leading-6 text-foreground/60">{t("scanInProgressBody")}</p>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          {jobs.map((job) => {
            const cancelling = job.status === "cancelling";
            return (
              <div key={job.id} className="rounded-md border border-border bg-panel px-4 py-3">
                <div className="flex min-w-0 items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {scanStatusLabel(job.status, job.message)}
                    </div>
                    <div
                      className="mt-1 truncate text-xs text-foreground/50"
                      title={displayPath(job.rootPath)}
                    >
                      {displayPath(job.rootPath)}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="subtle"
                    disabled={cancelling}
                    onClick={() => onCancel(job.id)}
                  >
                    {cancelling ? t("scanCancelPending") : t("cancel")}
                  </Button>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <ScanMetric label={t("scanDiscoveredCount")} value={job.discoveredCount} />
                  <ScanMetric label={t("scanImportedCount")} value={job.importedCount} />
                  <ScanMetric
                    label={t("scanFailedCount")}
                    value={job.failedCount}
                    danger={job.failedCount > 0}
                  />
                </div>

                <div
                  className="mt-4 h-1.5 overflow-hidden rounded-full bg-panelMuted"
                  role="progressbar"
                  aria-label={scanStatusLabel(job.status, job.message)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={scanProgressValue(job)}
                >
                  <span
                    className="block h-full rounded-full bg-accent transition-[width] duration-300"
                    style={{ width: scanProgressPercent(job) }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div
          className={`cover-grid grid-density-${layout.gridDensity} mt-7 overflow-hidden opacity-55`}
          aria-hidden="true"
        >
          {Array.from({ length: 12 }, (_, index) => (
            <div key={index}>
              <div
                className={`${coverAspectClass(layout.coverAspectRatio)} animate-pulse rounded-md bg-panelMuted`}
              />
              <div className="mt-2 h-3 w-3/4 animate-pulse rounded bg-panelMuted" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ScanMetric({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-foreground/50">{label}</div>
      <div className={`mt-0.5 font-semibold tabular-nums ${danger ? "text-danger" : ""}`}>
        {formatNumber(value)}
      </div>
    </div>
  );
}

function SkeletonGrid({ layout }: { layout: LayoutSettings }) {
  return (
    <div className={`cover-grid grid-density-${layout.gridDensity} flex-1 overflow-hidden p-5`}>
      {Array.from({ length: 24 }, (_, index) => (
        <div key={index}>
          <div
            className={`${coverAspectClass(layout.coverAspectRatio)} animate-pulse rounded-md bg-panelMuted`}
          />
          <div className="mt-2 h-4 w-3/4 animate-pulse rounded bg-panelMuted" />
        </div>
      ))}
    </div>
  );
}

function coverAspectClass(value: LayoutSettings["coverAspectRatio"]): string {
  if (value === "square") return "aspect-square";
  if (value === "tall") return "aspect-[3/5]";
  return "aspect-[2/3]";
}
