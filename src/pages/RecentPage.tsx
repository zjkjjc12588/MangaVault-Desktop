import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  BookOpen,
  CheckCircle2,
  Clock3,
  FolderOpen,
  Grid2X2,
  List,
  MoreHorizontal,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Virtuoso, VirtuosoGrid } from "react-virtuoso";
import { Button } from "../components/ui/Button";
import * as api from "../lib/api";
import { cn } from "../lib/cn";
import { displayLocalDateTime, displayPath } from "../lib/format";
import { formatUserError, getUiLocale } from "../lib/i18n";
import type {
  Book,
  RecentReadingFilter,
  RecentReadingItem,
  RecentReadingSort,
  RecentReadingView,
} from "../lib/types";
import { getCachedThumbnailDataUrl } from "../lib/thumbnailCache";
import { useBookActivation } from "../library/useBookActivation";
import { RECENT_FILTER_KEY, RECENT_SORT_KEY, RECENT_VIEW_KEY } from "../recent/recentReading";
import { useRecentStore } from "../stores/recentStore";
import { useToastStore } from "../stores/toastStore";

interface RecentPageProps {
  active: boolean;
  onOpenReader: () => void;
  onOpenLibrary: () => void;
}

export function RecentPage({ active, onOpenReader, onOpenLibrary }: RecentPageProps) {
  const state = useRecentStore();
  const activation = useBookActivation(
    onOpenReader,
    (book) => useRecentStore.getState().items.find((item) => item.book.id === book.id)?.currentPage,
  );
  const pushToast = useToastStore((value) => value.push);
  const [searchText, setSearchText] = useState(state.search);
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
  const historyMenuRef = useRef<globalThis.HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    void api.getSettings().then((settings) => {
      if (!disposed) useRecentStore.getState().syncSettings(settings);
    });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      useRecentStore.getState().setSearch(searchText.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    if (!historyMenuOpen) return;
    const closeOnPointerDown = (event: globalThis.PointerEvent) => {
      if (!historyMenuRef.current?.contains(event.target as globalThis.Node)) {
        setHistoryMenuOpen(false);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setHistoryMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [historyMenuOpen]);

  useEffect(() => {
    if (active) void useRecentStore.getState().load(true);
  }, [active, state.filter, state.search, state.sort]);

  const persistPreference = async (
    key: string,
    preferences: Partial<Pick<typeof state, "view" | "sort" | "filter">>,
  ) => {
    const previous = { view: state.view, sort: state.sort, filter: state.filter };
    useRecentStore.getState().setPreferences(preferences);
    try {
      await api.setSetting(key, Object.values(preferences)[0]);
    } catch (error) {
      useRecentStore.getState().setPreferences(previous);
      pushToast({
        title: text("saveFailed"),
        description: formatUserError(error),
        tone: "error",
      });
    }
  };

  const removeHistory = async (item: RecentReadingItem) => {
    try {
      const removedIndex = useRecentStore
        .getState()
        .items.findIndex((candidate) => candidate.book.id === item.book.id);
      await api.removeRecentReading(item.book.id);
      useRecentStore.getState().removeLocal(item.book.id);
      window.requestAnimationFrame(() => {
        const items = document.querySelectorAll<HTMLElement>(
          '[data-testid="recent-page"] [data-book-activation]',
        );
        items[Math.min(Math.max(0, removedIndex), items.length - 1)]?.focus();
      });
      pushToast({ title: text("removed"), description: text("progressKept"), tone: "success" });
    } catch (error) {
      pushToast({
        title: text("actionFailed"),
        description: formatUserError(error),
        tone: "error",
      });
    }
  };

  const resetProgress = async (item: RecentReadingItem) => {
    if (!window.confirm(text("resetConfirm").replace("{title}", item.book.title))) return;
    try {
      await api.resetReadingProgress(item.book.id);
      useRecentStore.getState().updateProgressLocal(item.book.id, 0, 0);
      pushToast({ title: text("progressReset"), tone: "success" });
    } catch (error) {
      pushToast({
        title: text("actionFailed"),
        description: formatUserError(error),
        tone: "error",
      });
    }
  };

  const markRead = async (item: RecentReadingItem) => {
    try {
      const progress = await api.markBookRead(item.book.id);
      useRecentStore
        .getState()
        .updateProgressLocal(item.book.id, progress.currentPage, progress.percent);
      pushToast({ title: text("markedRead"), tone: "success" });
    } catch (error) {
      pushToast({
        title: text("actionFailed"),
        description: formatUserError(error),
        tone: "error",
      });
    }
  };

  const clearAll = async () => {
    try {
      const allHistory = await api.listRecentReading({
        filter: "all",
        sort: "recent",
        limit: 1,
        offset: 0,
        timezoneOffsetMinutes: new Date().getTimezoneOffset(),
      });
      if (!window.confirm(text("clearConfirm").replace("{count}", String(allHistory.total)))) {
        return;
      }
      await api.clearReadingHistory();
      useRecentStore.getState().clearLocal();
      pushToast({ title: text("cleared"), description: text("progressKept"), tone: "success" });
    } catch (error) {
      pushToast({
        title: text("actionFailed"),
        description: formatUserError(error),
        tone: "error",
      });
    }
  };

  const openSource = async (book: Book) => {
    try {
      await api.openPathInShell(book.path);
    } catch (error) {
      pushToast({
        title: text("actionFailed"),
        description: formatUserError(error),
        tone: "error",
      });
    }
  };

  const itemActions = {
    open: activation.activateBook,
    remove: removeHistory,
    reset: resetProgress,
    markRead,
    openSource,
  };

  return (
    <section
      className="flex h-full min-w-0 flex-1 flex-col bg-background"
      data-testid="recent-page"
    >
      <header className="border-b border-border bg-panel px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">{text("title")}</h1>
            <p className="mt-0.5 text-xs text-foreground/55">{text("subtitle")}</p>
          </div>
          {state.total > 0 && (
            <div ref={historyMenuRef} className="relative">
              <Button
                size="icon"
                variant="subtle"
                title={text("historyMenu")}
                aria-label={text("historyMenu")}
                aria-haspopup="menu"
                aria-expanded={historyMenuOpen}
                onClick={() => setHistoryMenuOpen((open) => !open)}
              >
                <MoreHorizontal size={18} />
              </Button>
              {historyMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-11 z-50 min-w-52 rounded-md border border-border bg-panel p-1 shadow-xl"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-danger outline-none hover:bg-panelMuted focus:bg-panelMuted"
                    onClick={() => {
                      setHistoryMenuOpen(false);
                      void clearAll();
                    }}
                  >
                    <Trash2 size={15} /> {text("clearAll")}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label className="relative min-w-[220px] flex-1 sm:max-w-sm">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground/45"
            />
            <span className="sr-only">{text("search")}</span>
            <input
              type="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder={text("search")}
              className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm"
            />
          </label>
          <SelectControl
            label={text("sort")}
            value={state.sort}
            onChange={(value) =>
              void persistPreference(RECENT_SORT_KEY, { sort: value as RecentReadingSort })
            }
            options={[
              ["recent", text("sortRecent")],
              ["progress", text("sortProgress")],
              ["title", text("sortTitle")],
            ]}
          />
          <SelectControl
            label={text("filter")}
            value={state.filter}
            onChange={(value) =>
              void persistPreference(RECENT_FILTER_KEY, { filter: value as RecentReadingFilter })
            }
            options={[
              ["all", text("all")],
              ["unfinished", text("unfinished")],
              ["finished", text("finished")],
              ["today", text("today")],
              ["7days", text("sevenDays")],
              ["30days", text("thirtyDays")],
            ]}
          />
          <div className="flex rounded-md border border-border bg-background p-0.5">
            <ViewButton
              view="list"
              current={state.view}
              icon={<List size={16} />}
              onClick={(view) => void persistPreference(RECENT_VIEW_KEY, { view })}
            />
            <ViewButton
              view="grid"
              current={state.view}
              icon={<Grid2X2 size={16} />}
              onClick={(view) => void persistPreference(RECENT_VIEW_KEY, { view })}
            />
          </div>
        </div>
      </header>

      {state.error && (
        <div role="alert" className="border-b border-danger/40 bg-danger/10 px-5 py-2 text-sm">
          {state.error}
        </div>
      )}
      {!state.loaded && state.loading ? (
        <div className="grid flex-1 place-items-center text-sm text-foreground/55" aria-busy="true">
          {text("loading")}
        </div>
      ) : state.items.length === 0 ? (
        <div className="grid flex-1 place-items-center p-8 text-center">
          <div>
            <Clock3 className="mx-auto text-foreground/35" size={38} />
            <h2 className="mt-3 text-base font-semibold">
              {state.search || state.filter !== "all" ? text("noMatches") : text("emptyTitle")}
            </h2>
            <p className="mt-1 text-sm text-foreground/55">
              {state.search || state.filter !== "all" ? text("adjustFilters") : text("emptyBody")}
            </p>
            {state.search || state.filter !== "all" ? (
              <Button
                className="mt-4"
                variant="subtle"
                onClick={() => {
                  setSearchText("");
                  useRecentStore.getState().setSearch("");
                  void persistPreference(RECENT_FILTER_KEY, { filter: "all" });
                }}
              >
                <RotateCcw size={16} /> {text("clearFilters")}
              </Button>
            ) : (
              <Button className="mt-4" onClick={onOpenLibrary}>
                <BookOpen size={16} />
                {text("goLibrary")}
              </Button>
            )}
          </div>
        </div>
      ) : state.view === "grid" ? (
        <VirtuosoGrid
          key={`grid:${state.sort}:${state.filter}:${state.search}`}
          className="thin-scrollbar flex-1"
          data-testid="recent-grid"
          totalCount={state.items.length}
          initialTopMostItemIndex={Math.min(state.scrollIndex, state.items.length - 1)}
          listClassName="recent-grid-list"
          itemClassName="recent-grid-item"
          rangeChanged={({ startIndex, endIndex }) => {
            useRecentStore.getState().setScrollIndex(startIndex);
            if (endIndex >= state.items.length - 20) void useRecentStore.getState().load(false);
          }}
          itemContent={(index) => {
            const item = state.items[index];
            return item ? (
              <RecentGridItem item={item} activation={activation} actions={itemActions} />
            ) : null;
          }}
        />
      ) : (
        <Virtuoso
          key={`list:${state.sort}:${state.filter}:${state.search}`}
          className="thin-scrollbar flex-1"
          data-testid="recent-list"
          totalCount={state.items.length}
          initialTopMostItemIndex={Math.min(state.scrollIndex, state.items.length - 1)}
          rangeChanged={({ startIndex, endIndex }) => {
            useRecentStore.getState().setScrollIndex(startIndex);
            if (endIndex >= state.items.length - 20) void useRecentStore.getState().load(false);
          }}
          itemContent={(index) => {
            const item = state.items[index];
            return item ? (
              <div className="px-5 pb-2 first:pt-4">
                <RecentListItem item={item} activation={activation} actions={itemActions} />
              </div>
            ) : null;
          }}
        />
      )}
      {state.loadingMore && (
        <div className="border-t border-border px-5 py-2 text-center text-xs text-foreground/50">
          {text("loadingMore")}
        </div>
      )}
    </section>
  );
}

type Activation = ReturnType<typeof useBookActivation>;
interface ItemActions {
  open: (book: Book) => void;
  remove: (item: RecentReadingItem) => Promise<void>;
  reset: (item: RecentReadingItem) => Promise<void>;
  markRead: (item: RecentReadingItem) => Promise<void>;
  openSource: (book: Book) => Promise<void>;
}

function RecentGridItem({
  item,
  activation,
  actions,
}: {
  item: RecentReadingItem;
  activation: Activation;
  actions: ItemActions;
}) {
  return (
    <RecentContextMenu item={item} actions={actions}>
      <article
        role="option"
        {...activation.bindingsFor(item.book)}
        title={displayPath(item.book.path)}
        className={cn(
          "group min-w-0 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          activation.selectedBookId === item.book.id &&
            "ring-2 ring-accent ring-offset-2 ring-offset-background",
        )}
      >
        <div className="aspect-[2/3] overflow-hidden rounded-md border border-border bg-panel">
          <RecentCover book={item.book} />
        </div>
        <div className="mt-2 min-w-0">
          <div className="truncate text-sm font-medium">{item.book.title}</div>
          <ProgressSummary item={item} />
          <div className="mt-1 truncate text-xs text-foreground/45">
            {displayLocalDateTime(item.lastReadAt, getUiLocale())}
          </div>
        </div>
      </article>
    </RecentContextMenu>
  );
}

function RecentListItem({
  item,
  activation,
  actions,
}: {
  item: RecentReadingItem;
  activation: Activation;
  actions: ItemActions;
}) {
  return (
    <RecentContextMenu item={item} actions={actions}>
      <article
        role="option"
        {...activation.bindingsFor(item.book)}
        title={displayPath(item.book.path)}
        className={cn(
          "grid min-h-[112px] grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-4 rounded-md border border-border bg-panel p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
          activation.selectedBookId === item.book.id && "border-accent ring-1 ring-accent",
        )}
      >
        <div className="aspect-[2/3] overflow-hidden rounded border border-border bg-panelMuted">
          <RecentCover book={item.book} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{item.book.title}</div>
          {item.book.author && (
            <div className="mt-1 truncate text-xs text-foreground/50">{item.book.author}</div>
          )}
          <ProgressSummary item={item} />
          <div className="mt-1 text-xs text-foreground/45">
            {text("lastRead")} {displayLocalDateTime(item.lastReadAt, getUiLocale())}
          </div>
          {item.book.status !== "available" && (
            <div className="mt-1 text-xs text-amber-500">{text("sourceUnavailable")}</div>
          )}
        </div>
        <Button
          data-book-action
          size="sm"
          disabled={item.book.status !== "available"}
          onClick={() => actions.open(item.book)}
        >
          <BookOpen size={16} />
          {text("continue")}
        </Button>
      </article>
    </RecentContextMenu>
  );
}

function ProgressSummary({ item }: { item: RecentReadingItem }) {
  const percent = Math.round(item.progressPercent * 100);
  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs text-foreground/55">
        <span>
          {item.currentPage + 1}/{Math.max(item.totalPages, item.currentPage + 1)}
        </span>
        <span>{percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={`${item.book.title} ${percent}%`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-panelMuted"
      >
        <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function RecentCover({ book }: { book: Book }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setSrc(null);
    setFailed(false);
    if (book.pageCount <= 0) {
      setFailed(true);
      return () => controller.abort();
    }
    void getCachedThumbnailDataUrl(book.id, book.coverPageIndex, {
      signal: controller.signal,
      priority: "visible",
    })
      .then((value) => !controller.signal.aborted && setSrc(value))
      .catch((error: unknown) => {
        if (!(error instanceof Error && error.name === "AbortError")) setFailed(true);
      });
    return () => controller.abort();
  }, [book.coverPageIndex, book.id, book.pageCount]);
  if (!src || failed) {
    return <div className="grid h-full place-items-center text-xs text-foreground/35">MV</div>;
  }
  return <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />;
}

function RecentContextMenu({
  item,
  actions,
  children,
}: {
  item: RecentReadingItem;
  actions: ItemActions;
  children: ReactNode;
}) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-48 rounded-md border border-border bg-panel p-1 shadow-xl">
          <MenuItem onSelect={() => actions.open(item.book)} icon={<BookOpen size={15} />}>
            {text("continue")}
          </MenuItem>
          <MenuItem onSelect={() => void actions.markRead(item)} icon={<CheckCircle2 size={15} />}>
            {text("markRead")}
          </MenuItem>
          <MenuItem onSelect={() => void actions.reset(item)} icon={<RotateCcw size={15} />}>
            {text("resetProgress")}
          </MenuItem>
          <MenuItem
            onSelect={() => void actions.openSource(item.book)}
            icon={<FolderOpen size={15} />}
          >
            {text("openSource")}
          </MenuItem>
          <ContextMenu.Separator className="my-1 h-px bg-border" />
          <MenuItem onSelect={() => void actions.remove(item)} icon={<Trash2 size={15} />} danger>
            {text("remove")}
          </MenuItem>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function MenuItem({
  children,
  icon,
  danger = false,
  onSelect,
}: {
  children: ReactNode;
  icon: ReactNode;
  danger?: boolean;
  onSelect: () => void;
}) {
  return (
    <ContextMenu.Item
      className={cn(
        "flex cursor-default select-none items-center gap-2 rounded px-2 py-1.5 text-sm outline-none focus:bg-panelMuted",
        danger && "text-danger",
      )}
      onSelect={onSelect}
    >
      {icon}
      {children}
    </ContextMenu.Item>
  );
}

function SelectControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-md border border-border bg-background px-3 text-sm"
      >
        {options.map(([option, optionLabel]) => (
          <option key={option} value={option}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function ViewButton({
  view,
  current,
  icon,
  onClick,
}: {
  view: RecentReadingView;
  current: RecentReadingView;
  icon: ReactNode;
  onClick: (view: RecentReadingView) => void;
}) {
  const label = view === "grid" ? text("grid") : text("list");
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={current === view}
      onClick={() => onClick(view)}
      className={cn(
        "grid h-8 w-8 place-items-center rounded",
        current === view ? "bg-accent text-accentText" : "text-foreground/60 hover:bg-panelMuted",
      )}
    >
      {icon}
    </button>
  );
}

type RecentTextKey = keyof typeof recentText.zh;
const recentText = {
  zh: {
    title: "最近阅读",
    subtitle: "从上次停下的位置继续",
    search: "搜索最近阅读",
    sort: "排序",
    filter: "筛选",
    sortRecent: "最近阅读时间",
    sortProgress: "阅读进度",
    sortTitle: "标题",
    all: "全部",
    unfinished: "未读完",
    finished: "已读完",
    today: "今天",
    sevenDays: "最近 7 天",
    thirtyDays: "最近 30 天",
    list: "列表视图",
    grid: "网格视图",
    clearAll: "清除全部最近阅读",
    historyMenu: "最近阅读菜单",
    clearConfirm: "清除 {count} 条最近阅读记录？阅读进度和书签会保留。",
    emptyTitle: "尚无最近阅读",
    emptyBody: "打开一本漫画后会显示在这里。",
    noMatches: "没有匹配的最近阅读",
    adjustFilters: "请调整搜索或筛选条件。",
    clearFilters: "清除搜索和筛选",
    goLibrary: "前往漫画库",
    continue: "继续阅读",
    lastRead: "最后阅读",
    sourceUnavailable: "源文件当前不可用",
    remove: "从最近阅读中移除",
    resetProgress: "重置阅读进度",
    markRead: "标记为已读",
    openSource: "打开源文件夹",
    resetConfirm: "重置《{title}》的阅读进度？漫画和书签不会被删除。",
    removed: "已从最近阅读中移除",
    progressKept: "阅读进度、书签和漫画库均已保留。",
    progressReset: "阅读进度已重置",
    markedRead: "已标记为已读",
    cleared: "最近阅读已清除",
    actionFailed: "操作未完成",
    saveFailed: "偏好未保存",
    loading: "正在读取最近阅读...",
    loadingMore: "正在加载更多...",
  },
  en: {
    title: "Recent",
    subtitle: "Continue from where you left off",
    search: "Search recent reading",
    sort: "Sort",
    filter: "Filter",
    sortRecent: "Last read",
    sortProgress: "Progress",
    sortTitle: "Title",
    all: "All",
    unfinished: "Unfinished",
    finished: "Finished",
    today: "Today",
    sevenDays: "Last 7 days",
    thirtyDays: "Last 30 days",
    list: "List view",
    grid: "Grid view",
    clearAll: "Clear all recent reading",
    historyMenu: "Recent reading menu",
    clearConfirm: "Clear {count} recent items? Reading progress and bookmarks will be kept.",
    emptyTitle: "No recent reading yet",
    emptyBody: "Books you open will appear here.",
    noMatches: "No recent reading matches",
    adjustFilters: "Try changing the search or filters.",
    clearFilters: "Clear search and filters",
    goLibrary: "Go to library",
    continue: "Continue reading",
    lastRead: "Last read",
    sourceUnavailable: "Source file is currently unavailable",
    remove: "Remove from Recent",
    resetProgress: "Reset reading progress",
    markRead: "Mark as read",
    openSource: "Open source folder",
    resetConfirm: "Reset reading progress for {title}? The book and bookmarks will be kept.",
    removed: "Removed from Recent",
    progressKept: "Reading progress, bookmarks, and the library were kept.",
    progressReset: "Reading progress reset",
    markedRead: "Marked as read",
    cleared: "Recent reading cleared",
    actionFailed: "Action could not be completed",
    saveFailed: "Preference was not saved",
    loading: "Loading recent reading...",
    loadingMore: "Loading more...",
  },
} as const;

function text(key: RecentTextKey): string {
  return recentText[getUiLocale() === "zh-CN" ? "zh" : "en"][key];
}
