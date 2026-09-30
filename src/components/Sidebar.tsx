import { ChevronLeft, ChevronRight, Clock3, Library, Settings, Sparkles } from "lucide-react";
import { useSyncExternalStore } from "react";
import { cn } from "../lib/cn";
import { t } from "../lib/i18n";
import {
  navigationItems,
  resolveSidebarMode,
  SIDEBAR_COMPACT_MEDIA_QUERY,
  type AppRoute,
  type LayoutSettings,
} from "../lib/navigation";

interface SidebarProps {
  route: AppRoute;
  onRoute: (route: AppRoute) => void;
  preferredMode?: LayoutSettings["sidebarMode"];
  onPreferredModeChange: (mode: LayoutSettings["sidebarMode"]) => void;
}

export function Sidebar({
  route,
  onRoute,
  preferredMode = "expanded",
  onPreferredModeChange,
}: SidebarProps) {
  const narrowViewport = useSyncExternalStore(
    subscribeNarrowViewport,
    isNarrowViewport,
    () => false,
  );
  const mode = resolveSidebarMode(preferredMode, narrowViewport);
  const compact = mode.effective === "compact";
  const toggleLabel = compact ? t("expandSidebar") : t("collapseSidebar");
  const expansionBlocked = compact && narrowViewport;

  return (
    <aside
      data-testid="app-sidebar"
      data-preferred-mode={mode.preferred}
      data-effective-mode={mode.effective}
      data-responsive-constrained={mode.constrained ? "true" : "false"}
      className={cn(
        "flex shrink-0 flex-col border-r border-border bg-panel transition-[width] duration-150 ease-out",
        compact ? "w-[60px]" : "w-[184px]",
      )}
    >
      <div
        className={cn(
          "flex h-16 items-center gap-3 border-b border-border",
          compact ? "justify-center px-2" : "px-3",
        )}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-accentText">
          <Sparkles size={20} />
        </div>
        <div className={cn("min-w-0", compact && "sr-only")}>
          <div className="truncate text-base font-semibold">MangaVault</div>
          <div className="text-xs text-foreground/55">{t("desktopApp")}</div>
        </div>
      </div>
      <nav className={cn("space-y-1", compact ? "p-2" : "p-3")} aria-label={t("navigation")}>
        {navigationItems.map((item) => {
          const Icon =
            item.route === "library" ? Library : item.route === "recent" ? Clock3 : Settings;
          const active = route === item.route;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? "page" : undefined}
              aria-label={t(item.route)}
              onClick={() => {
                if (!active) onRoute(item.route);
              }}
              className={cn(
                "flex h-10 w-full items-center gap-3 rounded-md text-left text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                compact ? "justify-center px-0" : "px-3",
                active
                  ? "bg-accent text-accentText"
                  : "text-foreground/76 hover:bg-panelMuted hover:text-foreground",
              )}
              title={compact ? t(item.route) : undefined}
            >
              <Icon size={18} />
              <span className={cn(compact && "sr-only")}>{t(item.route)}</span>
            </button>
          );
        })}
      </nav>
      <div className={cn("mt-auto border-t border-border", compact ? "p-2" : "p-3")}>
        <button
          type="button"
          data-testid="sidebar-toggle"
          aria-label={expansionBlocked ? t("sidebarWindowTooNarrow") : toggleLabel}
          title={expansionBlocked ? t("sidebarWindowTooNarrow") : toggleLabel}
          disabled={expansionBlocked}
          onClick={() => onPreferredModeChange(compact ? "expanded" : "compact")}
          className={cn(
            "flex h-9 w-full items-center rounded-md text-sm text-foreground/70 transition hover:bg-panelMuted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45",
            compact ? "justify-center" : "gap-3 px-3",
          )}
        >
          {compact ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          {!compact && <span>{t("collapseSidebar")}</span>}
        </button>
      </div>
      <div
        className={cn(
          "border-t border-border p-3 text-xs leading-5 text-foreground/55",
          compact && "hidden",
        )}
      >
        {t("offlineSafetyBrief")}
      </div>
    </aside>
  );
}

function getSidebarMediaQuery(): ReturnType<typeof window.matchMedia> | null {
  return typeof window === "undefined" ? null : window.matchMedia(SIDEBAR_COMPACT_MEDIA_QUERY);
}

function isNarrowViewport(): boolean {
  return getSidebarMediaQuery()?.matches ?? false;
}

function subscribeNarrowViewport(listener: () => void): () => void {
  const media = getSidebarMediaQuery();
  if (!media) return () => undefined;
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
