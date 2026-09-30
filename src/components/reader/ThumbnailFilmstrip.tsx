import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { cn } from "../../lib/cn";
import { t } from "../../lib/i18n";
import { getCachedThumbnailDataUrl } from "../../lib/thumbnailCache";

interface ThumbnailFilmstripProps {
  bookId: number;
  pageCount: number;
  currentPage: number;
  lowMemory: boolean;
  onJump: (page: number) => void;
}

export function ThumbnailFilmstrip({
  bookId,
  pageCount,
  currentPage,
  lowMemory,
  onJump,
}: ThumbnailFilmstripProps) {
  const listRef = useRef<VirtuosoHandle>(null);

  useEffect(() => {
    listRef.current?.scrollToIndex({ index: currentPage, align: "center", behavior: "auto" });
  }, [currentPage]);

  return (
    <div className="mt-3 h-24" data-testid="thumbnail-filmstrip">
      <Virtuoso
        ref={listRef}
        horizontalDirection
        style={{ height: "100%" }}
        totalCount={pageCount}
        initialTopMostItemIndex={currentPage}
        increaseViewportBy={lowMemory ? 64 : 160}
        itemContent={(page) => (
          <ThumbnailItem
            bookId={bookId}
            page={page}
            current={page === currentPage}
            onJump={onJump}
          />
        )}
      />
    </div>
  );
}

function ThumbnailItem({
  bookId,
  page,
  current,
  onJump,
}: {
  bookId: number;
  page: number;
  current: boolean;
  onJump: (page: number) => void;
}) {
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    void getCachedThumbnailDataUrl(bookId, page, {
      signal: controller.signal,
      priority: current ? "reader" : "visible",
    }).then(
      (nextSource) => setSource(nextSource),
      (error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setFailed(true);
      },
    );
    return () => controller.abort();
  }, [attempt, bookId, current, page]);

  return (
    <div className="flex h-24 w-[68px] shrink-0 items-center justify-center px-1.5">
      <button
        type="button"
        data-thumbnail-page={page}
        className={cn(
          "relative flex h-[84px] w-14 items-center justify-center overflow-hidden rounded border-2 bg-background text-[10px] text-foreground/60 outline-none focus-visible:ring-2 focus-visible:ring-accent",
          current ? "border-accent shadow-focus" : "border-border hover:border-foreground/45",
        )}
        aria-label={`${t("page")} ${page + 1}`}
        aria-current={current ? "page" : undefined}
        title={`${t("page")} ${page + 1}`}
        onClick={() => {
          if (failed) {
            setSource(null);
            setAttempt((value) => value + 1);
            return;
          }
          onJump(page);
        }}
      >
        {source ? (
          <img src={source} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : failed ? (
          <span className="flex flex-col items-center gap-1 px-1 text-center">
            <RefreshCw size={14} />
            {t("retry")}
          </span>
        ) : (
          <span className="h-10 w-8 animate-pulse rounded-sm bg-panelMuted" />
        )}
        <span className="absolute bottom-0.5 right-0.5 rounded-sm bg-black/75 px-1 py-0.5 text-[9px] text-white">
          {page + 1}
        </span>
      </button>
    </div>
  );
}
