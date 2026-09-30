import * as Slider from "@radix-ui/react-slider";
import {
  AlertTriangle,
  Bookmark,
  BookOpen,
  CircleHelp,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Images,
  History,
  Library,
  List,
  Maximize,
  Minimize,
  MoreHorizontal,
  Palette,
  RefreshCw,
  RotateCw,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  WandSparkles,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
  type ReactNode,
  type WheelEvent,
} from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { ThumbnailFilmstrip } from "../components/reader/ThumbnailFilmstrip";
import { Button } from "../components/ui/Button";
import { cn } from "../lib/cn";
import { t } from "../lib/i18n";
import { DEFAULT_IMAGE_ADJUSTMENTS, hasImageAdjustments } from "../lib/readerImageSettings";
import {
  getReaderPresentation,
  setReaderPresentation,
  subscribeReaderPresentation,
} from "../lib/readerPresentation";
import {
  getReaderLaunchPreferences,
  persistStableReaderState,
  resolveReaderLaunchTarget,
} from "../lib/readerLaunch";
import {
  loadReaderExperience,
  markFullscreenHintSeen,
  markReaderTutorialSeen,
  type ReaderExperiencePreferences,
} from "../lib/readerExperience";
import {
  clampZoom,
  canTriggerWheelPageTurn,
  visibleRangePage,
  wheelPageTurnDirection,
  zoomFromWheel,
} from "../reader/readerCore";
import {
  canAutoHideChrome,
  emptyChromeGuards,
  initialReaderUiState,
  readerEdgeHotZone,
  readerEscapeAction,
  readerUiReducer,
  type ReaderEdgeHotZone,
  type ReaderOverlay,
} from "../reader/readerUiState";
import { useReaderStore } from "../stores/readerStore";
import { useToastStore } from "../stores/toastStore";
import type { DecodedPageFrame } from "../reader/readerPageCache";
import { readerViewportSpacing, resolveReaderControlsLayout } from "../reader/readerLayout";
import {
  beginReaderPointerGesture,
  expirePendingCenterClick,
  resolveReaderPointerGesture,
  updateReaderPointerGesture,
  type PendingCenterClick,
  type ReaderGestureAction,
  type ReaderGestureGuards,
  type ReaderGestureResolution,
  type ReaderPointerGestureState,
} from "../reader/readerPointerGesture";
import { useShortcutHandler } from "../shortcuts/useShortcut";
import { FocusReadingTransitionCoordinator } from "../reader/readerFocusTransition";

export function ReaderPage({
  onReturn,
  returnLocation,
}: {
  onReturn: () => void;
  returnLocation: "library" | "recent";
}) {
  const {
    sessionId,
    book,
    pages,
    chapters,
    pageCache,
    committedFrames,
    bookmarks,
    currentPage,
    requestedPage,
    loadingPage,
    committedPage,
    error,
    settings,
    next,
    previous,
    goToPage,
    toggleBookmark,
    updateSettings,
    flushProgress,
    retryCurrentPage,
  } = useReaderStore();
  const [ui, dispatchUi] = useReducer(readerUiReducer, initialReaderUiState);
  const [fullscreen, setFullscreen] = useState(() => Boolean(document.fullscreenElement));
  const [focusTransition, setFocusTransition] = useState<"idle" | "entering" | "exiting">("idle");
  const [presentationAnnouncement, setPresentationAnnouncement] = useState("");
  const [experience, setExperience] = useState<ReaderExperiencePreferences | null>(null);
  const [chromeGuards, setChromeGuards] = useState(emptyChromeGuards);
  const chromeGuardsRef = useRef(emptyChromeGuards);
  const [pageInput, setPageInput] = useState("1");
  const readerRef = useRef<HTMLElement>(null);
  const overlayRef = useRef<HTMLElement | null>(null);
  const overlayFocusRef = useRef<HTMLButtonElement | null>(null);
  const focusCoordinatorRef = useRef<FocusReadingTransitionCoordinator | null>(null);
  const handledLaunchSession = useRef(0);
  const suppressStableStateWrite = useRef(false);
  const scrollRef = useRef<VirtuosoHandle>(null);
  const scrollDrivenPage = useRef<number | null>(null);
  const lastWheelPageTurnAt = useRef(Number.NEGATIVE_INFINITY);
  const centerClickTimer = useRef<number | undefined>(undefined);
  const pendingCenterClick = useRef<PendingCenterClick | null>(null);
  const pendingCenterId = useRef(0);
  const edgeRevealTimer = useRef<number | undefined>(undefined);
  const edgeZone = useRef<ReaderEdgeHotZone>(null);
  const inertiaTimer = useRef<number | undefined>(undefined);
  const pointerGesture = useRef<ReaderPointerGestureState | null>(null);
  const panOrigin = useRef({ x: 0, y: 0 });
  const imeComposing = useRef(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const presentation = useSyncExternalStore(
    subscribeReaderPresentation,
    getReaderPresentation,
    getReaderPresentation,
  );
  const imagePanelOpen = ui.overlay === "image";
  const advancedImagePanelOpen = ui.overlay === "advanced-image";
  const bookmarkPanelOpen = ui.overlay === "bookmarks";
  const thumbnailsOpen = ui.overlay === "thumbnails";
  const moreMenuOpen = ui.overlay === "more";
  const tutorialOpen = ui.overlay === "tutorial";
  const fullscreenHintOpen = ui.overlay === "fullscreen-hint";
  const focusPromptOpen = ui.overlay === "focus-prompt";
  const focusReadingActive = presentation === "focus";
  if (!focusCoordinatorRef.current) {
    focusCoordinatorRef.current = new FocusReadingTransitionCoordinator();
  }
  const topChromeVisible = ui.chrome === "all" || ui.chrome === "top";
  const bottomChromeVisible = ui.chrome === "all" || ui.chrome === "bottom";
  const sideControlsVisible = ui.chrome === "all";
  const resolvedControlsLayout = resolveReaderControlsLayout(settings.controlsLayout, presentation);
  const controlsOverlay = resolvedControlsLayout === "overlay";
  const controlsReserved = !controlsOverlay;
  const revealChrome = useCallback(
    (region: "all" | "top" | "bottom" = "all") => dispatchUi({ type: "reveal", region }),
    [],
  );
  const updateChromeGuards = useCallback((update: Partial<typeof emptyChromeGuards>) => {
    chromeGuardsRef.current = { ...chromeGuardsRef.current, ...update };
    setChromeGuards(chromeGuardsRef.current);
  }, []);
  const pushToast = useToastStore((state) => state.push);
  const openOverlay = useCallback((overlay: Exclude<ReaderOverlay, null>) => {
    dispatchUi({ type: "open-overlay", overlay });
  }, []);
  const dismissOverlay = useCallback(() => {
    const overlay = ui.overlay;
    if (!overlay) return;
    dispatchUi({ type: "close-overlay" });
    if (overlay === "tutorial" && !experience?.tutorialSeen) {
      setExperience((current) =>
        current ? { ...current, tutorialSeen: true, fullscreenHintSeen: true } : current,
      );
      void markReaderTutorialSeen().catch((err) => {
        pushToast({
          title: t("readerSettingsSaveFailed"),
          description: String(err),
          tone: "error",
        });
      });
      if (!experience?.fullscreenHintSeen) {
        void markFullscreenHintSeen().catch((err) => {
          pushToast({
            title: t("readerSettingsSaveFailed"),
            description: String(err),
            tone: "error",
          });
        });
      }
    }
    if (overlay === "fullscreen-hint" && !experience?.fullscreenHintSeen) {
      setExperience((current) => (current ? { ...current, fullscreenHintSeen: true } : current));
      void markFullscreenHintSeen().catch((err) => {
        pushToast({
          title: t("readerSettingsSaveFailed"),
          description: String(err),
          tone: "error",
        });
      });
    }
  }, [experience, pushToast, ui.overlay]);
  const toggleSystemFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        if (!readerRef.current) throw new Error(t("fullscreenUnavailable"));
        await readerRef.current.requestFullscreen();
      }
    } catch (err) {
      pushToast({ title: t("fullscreenFailed"), description: String(err), tone: "error" });
    }
  }, [pushToast]);
  const enterFocusReading = useCallback(
    async (source: "manual" | "automatic" | "prompt" = "manual") => {
      const coordinator = focusCoordinatorRef.current;
      if (!coordinator || focusReadingActive) return focusReadingActive;
      const previousPresentation = presentation;
      setFocusTransition("entering");
      const result = await coordinator.run("entering", {
        prepare: () => {
          dispatchUi({ type: "close-overlay" });
          revealChrome();
        },
        perform: async () => {
          if (document.fullscreenElement !== readerRef.current) {
            if (!readerRef.current) throw new Error(t("fullscreenUnavailable"));
            await readerRef.current.requestFullscreen();
          }
        },
        confirmed: () => document.fullscreenElement === readerRef.current,
        commit: async () => {
          setReaderPresentation("focus");
          dispatchUi({ type: "enter-immersive" });
          setPresentationAnnouncement(t("focusReadingEnteredAnnouncement"));
          try {
            await persistStableReaderState("focus");
          } catch (error) {
            pushToast({
              title: t("readerSettingsSaveFailed"),
              description: String(error),
              tone: "error",
            });
          }
          if (experience && !experience.fullscreenHintSeen) openOverlay("fullscreen-hint");
        },
        rollback: () => {
          setReaderPresentation(previousPresentation);
          revealChrome();
        },
      });
      if (coordinator.getPhase() === "idle") setFocusTransition("idle");
      if (!result.committed && !result.stale) {
        if (source === "automatic") {
          openOverlay("focus-prompt");
        } else {
          pushToast({
            title: t("focusReadingFailed"),
            description: String(result.error ?? t("fullscreenUnavailable")),
            tone: "error",
          });
        }
      }
      return result.committed;
    },
    [experience, focusReadingActive, openOverlay, presentation, pushToast, revealChrome],
  );
  const exitFocusReading = useCallback(
    async ({ persist = true }: { persist?: boolean } = {}) => {
      const coordinator = focusCoordinatorRef.current;
      if (!coordinator || !focusReadingActive) return !focusReadingActive;
      setFocusTransition("exiting");
      const result = await coordinator.run("exiting", {
        prepare: () => {
          dispatchUi({ type: "close-overlay" });
          revealChrome();
        },
        perform: async () => {
          if (document.fullscreenElement === readerRef.current) await document.exitFullscreen();
        },
        confirmed: () => document.fullscreenElement !== readerRef.current,
        commit: async () => {
          setReaderPresentation("normal");
          dispatchUi({ type: "windowed" });
          setPresentationAnnouncement(t("focusReadingExitedAnnouncement"));
          if (persist) {
            try {
              await persistStableReaderState("windowed");
            } catch (error) {
              pushToast({
                title: t("readerSettingsSaveFailed"),
                description: String(error),
                tone: "error",
              });
            }
          }
          window.requestAnimationFrame(() =>
            readerRef.current
              ?.querySelector<HTMLButtonElement>("[data-focus-reading-button]")
              ?.focus(),
          );
        },
        rollback: () => {
          setReaderPresentation("focus");
          revealChrome();
        },
      });
      if (coordinator.getPhase() === "idle") setFocusTransition("idle");
      if (!result.committed && !result.stale) {
        pushToast({
          title: t("focusReadingExitFailed"),
          description: String(result.error ?? t("fullscreenUnavailable")),
          tone: "error",
        });
      }
      return result.committed;
    },
    [focusReadingActive, pushToast, revealChrome],
  );
  const toggleFocusReading = useCallback(async () => {
    if (focusReadingActive) return exitFocusReading();
    return enterFocusReading("manual");
  }, [enterFocusReading, exitFocusReading, focusReadingActive]);
  const toggleImmersive = useCallback(async () => {
    if (presentation === "focus") {
      setReaderPresentation(document.fullscreenElement ? "fullscreen" : "normal");
      revealChrome();
      return;
    }
    if (presentation === "immersive") {
      dispatchUi({ type: "close-overlay" });
      setReaderPresentation(document.fullscreenElement ? "fullscreen" : "normal");
      revealChrome();
      return;
    }
    try {
      dispatchUi({ type: "close-overlay" });
      if (!document.fullscreenElement) await readerRef.current?.requestFullscreen();
      setReaderPresentation("immersive");
      dispatchUi({ type: "enter-immersive" });
    } catch (err) {
      pushToast({ title: t("fullscreenFailed"), description: String(err), tone: "error" });
    }
  }, [presentation, pushToast, revealChrome]);
  const returnToSource = useCallback(async () => {
    focusCoordinatorRef.current?.invalidate();
    setFocusTransition("idle");
    await flushProgress();
    suppressStableStateWrite.current = true;
    try {
      if (document.fullscreenElement === readerRef.current) await document.exitFullscreen();
    } catch {
      setReaderPresentation("normal");
    }
    suppressStableStateWrite.current = false;
    setReaderPresentation("normal");
    dispatchUi({ type: "windowed" });
    onReturn();
  }, [flushProgress, onReturn]);
  const toggleReaderControls = useCallback(() => {
    dispatchUi({ type: "toggle-controls" });
    return true;
  }, []);

  useShortcutHandler(
    "overlay.escape",
    () => {
      dismissOverlay();
      return true;
    },
    Boolean(book && ui.overlay),
  );
  useShortcutHandler(
    "overlay.confirm",
    () => {
      dismissOverlay();
      return true;
    },
    Boolean(book && (tutorialOpen || fullscreenHintOpen)),
  );
  useShortcutHandler(
    "reader.escapePresentation",
    () => {
      const action = readerEscapeAction({ overlayOpen: false, presentation, fullscreen });
      if (action === "exit-focus") {
        void exitFocusReading();
        return true;
      }
      if (action === "exit-immersive") {
        setReaderPresentation(document.fullscreenElement ? "fullscreen" : "normal");
        revealChrome();
        return true;
      }
      if (action === "exit-fullscreen") {
        void document.exitFullscreen();
        return true;
      }
      return false;
    },
    Boolean(book && !ui.overlay),
  );
  useShortcutHandler(
    "reader.nextPage",
    ({ binding }) => {
      void (binding.normalizedKey === "ArrowRight" && settings.direction === "rtl"
        ? previous()
        : next());
      return true;
    },
    Boolean(book && !ui.overlay),
  );
  useShortcutHandler(
    "reader.previousPage",
    ({ binding }) => {
      void (binding.normalizedKey === "ArrowLeft" && settings.direction === "rtl"
        ? next()
        : previous());
      return true;
    },
    Boolean(book && !ui.overlay),
  );
  useShortcutHandler(
    "reader.bookmark",
    () => {
      void toggleBookmark();
      return true;
    },
    Boolean(book && !ui.overlay),
  );
  useShortcutHandler(
    "reader.fullscreen",
    () => {
      void toggleFocusReading();
      return true;
    },
    Boolean(book && !ui.overlay),
  );
  useShortcutHandler(
    "reader.immersive",
    () => {
      void toggleImmersive();
      return true;
    },
    Boolean(book && !ui.overlay),
  );
  useShortcutHandler("reader.toggleControls", toggleReaderControls, Boolean(book && !ui.overlay));
  useShortcutHandler(
    "reader.returnLibrary",
    () => {
      void returnToSource();
      return true;
    },
    Boolean(book && !ui.overlay),
  );
  useShortcutHandler(
    "reader.thumbnails",
    () => {
      if (thumbnailsOpen) dismissOverlay();
      else openOverlay("thumbnails");
      return true;
    },
    Boolean(book && (!ui.overlay || thumbnailsOpen)),
  );
  useShortcutHandler(
    "reader.fitWidth",
    () => {
      updateSettings({ fit: "width" });
      return true;
    },
    Boolean(book && !ui.overlay),
  );
  useShortcutHandler(
    "reader.fitHeight",
    () => {
      updateSettings({ fit: "height" });
      return true;
    },
    Boolean(book && !ui.overlay),
  );
  useShortcutHandler(
    "reader.zoomIn",
    () => {
      updateSettings({ zoom: clampZoom(settings.zoom + 10) });
      return true;
    },
    Boolean(book && !ui.overlay),
  );
  useShortcutHandler(
    "reader.zoomOut",
    () => {
      updateSettings({ zoom: clampZoom(settings.zoom - 10) });
      return true;
    },
    Boolean(book && !ui.overlay),
  );

  useEffect(() => {
    if (!book) return;
    let cancelled = false;
    void loadReaderExperience()
      .then((preferences) => {
        if (cancelled) return;
        setExperience(preferences);
        if (!preferences.tutorialSeen) openOverlay("tutorial");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [book, openOverlay]);

  useEffect(() => {
    if (
      !book ||
      sessionId === 0 ||
      handledLaunchSession.current === sessionId ||
      committedFrames.length === 0 ||
      !experience ||
      !experience.tutorialSeen ||
      ui.overlay
    ) {
      return;
    }
    handledLaunchSession.current = sessionId;
    if (resolveReaderLaunchTarget(getReaderLaunchPreferences()) === "focus") {
      void enterFocusReading("automatic");
    }
  }, [book, committedFrames.length, enterFocusReading, experience, sessionId, ui.overlay]);

  useEffect(() => {
    updateChromeGuards({ panelOpen: Boolean(ui.overlay) });
    if (ui.overlay) {
      window.clearTimeout(centerClickTimer.current);
      pendingCenterClick.current = null;
    }
    if (ui.overlay) window.setTimeout(() => overlayFocusRef.current?.focus(), 0);
  }, [ui.overlay, updateChromeGuards]);

  useEffect(() => {
    if (!fullscreenHintOpen) return;
    const timer = window.setTimeout(() => dismissOverlay(), 6_500);
    return () => window.clearTimeout(timer);
  }, [dismissOverlay, fullscreenHintOpen]);

  useEffect(() => {
    const syncFullscreen = () => {
      const active = document.fullscreenElement === readerRef.current;
      setFullscreen(active);
      const phase = focusCoordinatorRef.current?.getPhase() ?? "idle";
      if (phase !== "idle") return;
      if (active && presentation !== "immersive" && presentation !== "focus") {
        setReaderPresentation("fullscreen");
        revealChrome();
      }
      if (!active && presentation !== "normal") {
        const exitedFocus = presentation === "focus";
        setReaderPresentation("normal");
        dispatchUi({ type: "windowed" });
        if (exitedFocus && !suppressStableStateWrite.current) {
          void persistStableReaderState("windowed").catch(() => undefined);
        }
      }
    };
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, [presentation, revealChrome]);

  useEffect(() => {
    if (!book || ui.chrome === "hidden" || !canAutoHideChrome(presentation, chromeGuards)) {
      return;
    }
    const timer = window.setTimeout(() => dispatchUi({ type: "hide" }), 2600);
    return () => window.clearTimeout(timer);
  }, [book, chromeGuards, presentation, ui.chrome]);

  useEffect(() => {
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (
        !ui.overlay ||
        tutorialOpen ||
        fullscreenHintOpen ||
        overlayRef.current?.contains(target)
      ) {
        return;
      }
      dismissOverlay();
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [dismissOverlay, fullscreenHintOpen, tutorialOpen, ui.overlay]);

  useEffect(
    () => () => {
      focusCoordinatorRef.current?.invalidate();
      suppressStableStateWrite.current = true;
      if (document.fullscreenElement === readerRef.current) {
        void document.exitFullscreen();
      }
      window.clearTimeout(centerClickTimer.current);
      window.clearTimeout(edgeRevealTimer.current);
      window.clearTimeout(inertiaTimer.current);
      setReaderPresentation("normal");
    },
    [],
  );

  useEffect(() => {
    const beginComposition = () => {
      imeComposing.current = true;
    };
    const endComposition = () => {
      imeComposing.current = false;
    };
    document.addEventListener("compositionstart", beginComposition);
    document.addEventListener("compositionend", endComposition);
    return () => {
      document.removeEventListener("compositionstart", beginComposition);
      document.removeEventListener("compositionend", endComposition);
    };
  }, []);

  useEffect(() => {
    updateChromeGuards({ blockingError: Boolean(error) });
    if (error) revealChrome();
  }, [error, revealChrome, updateChromeGuards]);

  useEffect(() => {
    const flush = () => void flushProgress();
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      flush();
    };
  }, [flushProgress]);

  useEffect(() => {
    if (!book || settings.mode !== "scroll") return;
    if (scrollDrivenPage.current === currentPage) {
      scrollDrivenPage.current = null;
      return;
    }
    scrollRef.current?.scrollToIndex({ index: currentPage, align: "start", behavior: "auto" });
  }, [book, currentPage, settings.mode]);

  useEffect(() => {
    setPageInput(String(Math.min(currentPage + 1, Math.max(1, pages.length))));
  }, [currentPage, pages.length]);

  useEffect(() => {
    if (settings.zoom <= 100 || settings.mode === "scroll") setPanOffset({ x: 0, y: 0 });
  }, [currentPage, settings.mode, settings.zoom]);

  const filter = useMemo(
    () =>
      [
        `brightness(${settings.brightness}%)`,
        `contrast(${settings.contrast}%)`,
        `saturate(${settings.saturation}%)`,
        settings.grayscale ? "grayscale(1)" : "",
        settings.night ? "invert(0.92) hue-rotate(180deg)" : "",
      ]
        .filter(Boolean)
        .join(" "),
    [settings],
  );

  const imageAdjustmentsChanged = hasImageAdjustments(settings);

  const resetImageAdjustments = () => {
    updateSettings(DEFAULT_IMAGE_ADJUSTMENTS);
  };

  const gestureSettings = useMemo(
    () => ({
      direction: settings.direction,
      mode: settings.mode,
      sideClickPaging: settings.sideClickPaging,
      centerClickControls: settings.centerClickControls,
      doubleClickZoom: settings.doubleClickZoom,
      doubleClickInterval: settings.doubleClickInterval,
      dragPan: settings.dragPan,
      zoom: settings.zoom,
    }),
    [
      settings.centerClickControls,
      settings.direction,
      settings.doubleClickInterval,
      settings.doubleClickZoom,
      settings.dragPan,
      settings.mode,
      settings.sideClickPaging,
      settings.zoom,
    ],
  );

  const runGestureActions = useCallback(
    (actions: ReaderGestureAction[]) => {
      for (const action of actions) {
        if (action === "previous") void previous();
        if (action === "next") void next();
        if (action === "toggle-controls") toggleReaderControls();
        if (action === "toggle-zoom") {
          updateSettings({ zoom: settings.zoom === 100 ? 200 : 100 });
        }
      }
    },
    [next, previous, settings.zoom, toggleReaderControls, updateSettings],
  );

  const applyGestureResolution = useCallback(
    (resolution: ReaderGestureResolution) => {
      const pendingChanged = resolution.pendingCenterClick?.id !== pendingCenterClick.current?.id;
      if (pendingChanged) window.clearTimeout(centerClickTimer.current);
      pendingCenterClick.current = resolution.pendingCenterClick;
      runGestureActions(resolution.actions);
      if (pendingChanged && resolution.pendingCenterClick) {
        const pendingId = resolution.pendingCenterClick.id;
        centerClickTimer.current = window.setTimeout(() => {
          const expired = expirePendingCenterClick(pendingCenterClick.current, pendingId);
          pendingCenterClick.current = expired.pendingCenterClick;
          runGestureActions(expired.actions);
        }, gestureSettings.doubleClickInterval);
      }
    },
    [gestureSettings.doubleClickInterval, runGestureActions],
  );

  const currentGestureGuards = useCallback(
    (event: PointerEvent<HTMLElement>): ReaderGestureGuards => ({
      defaultPrevented: event.defaultPrevented,
      isInteractiveTarget: isInteractiveTarget(event.target),
      isOverlayOpen: Boolean(ui.overlay),
      isSelecting: Boolean(window.getSelection()?.toString()),
      isControlFocused: hasKeyboardControlFocus() || chromeGuardsRef.current.pageInputActive,
      isDraggingControl: chromeGuardsRef.current.draggingControl,
      isInertialScrolling: chromeGuardsRef.current.inertialScrolling,
      isComposing: imeComposing.current,
      isPrimaryPointer: event.isPrimary,
    }),
    [ui.overlay],
  );

  const handleContentPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const gesture = pointerGesture.current;
      if (gesture?.pointerId === event.pointerId) {
        const updated = updateReaderPointerGesture(
          gesture,
          { x: event.clientX, y: event.clientY },
          gestureSettings,
        );
        pointerGesture.current = updated;
        if (updated.isDragging) {
          updateChromeGuards({ contentGesture: true });
          setPanOffset({
            x: panOrigin.current.x + event.clientX - updated.pointerDownPosition.x,
            y: panOrigin.current.y + event.clientY - updated.pointerDownPosition.y,
          });
        }
      }
      const bounds = readerRef.current?.getBoundingClientRect();
      if (!bounds) return;
      if (presentation === "normal") return;
      const nextZone = readerEdgeHotZone(event.clientY, bounds.top, bounds.height);
      if (
        nextZone === edgeZone.current ||
        ui.overlay ||
        chromeGuards.contentGesture ||
        isInteractiveTarget(event.target)
      ) {
        return;
      }
      edgeZone.current = nextZone;
      window.clearTimeout(edgeRevealTimer.current);
      if (!nextZone) return;
      edgeRevealTimer.current = window.setTimeout(() => revealChrome(nextZone), 100);
    },
    [
      chromeGuards.contentGesture,
      gestureSettings,
      presentation,
      revealChrome,
      ui.overlay,
      updateChromeGuards,
    ],
  );

  const handleContentPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const bounds = readerRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        !isEditableTarget(active) &&
        isInteractiveTarget(active) &&
        active.matches(":focus-visible")
      ) {
        active.blur();
      }
      const guards = currentGestureGuards(event);
      pointerGesture.current = beginReaderPointerGesture({
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        clientX: event.clientX,
        clientY: event.clientY,
        button: event.button,
        time: event.timeStamp,
        bounds,
        settings: gestureSettings,
        guards,
      });
      panOrigin.current = panOffset;
      if (pointerGesture.current.eligible) event.currentTarget.setPointerCapture(event.pointerId);
    },
    [currentGestureGuards, gestureSettings, panOffset],
  );

  const handleContentPointerUp = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const gesture = pointerGesture.current;
      pointerGesture.current = null;
      updateChromeGuards({ contentGesture: false });
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      pendingCenterId.current += 1;
      applyGestureResolution(
        resolveReaderPointerGesture({
          state: gesture,
          pointerId: event.pointerId,
          position: { x: event.clientX, y: event.clientY },
          releasedAt: event.timeStamp,
          settings: gestureSettings,
          guards: currentGestureGuards(event),
          pendingCenterClick: pendingCenterClick.current,
          nextPendingId: pendingCenterId.current,
        }),
      );
    },
    [applyGestureResolution, currentGestureGuards, gestureSettings, updateChromeGuards],
  );

  const cancelContentGesture = useCallback(() => {
    pointerGesture.current = null;
    updateChromeGuards({ contentGesture: false });
  }, [updateChromeGuards]);

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLElement>) => {
      updateChromeGuards({ inertialScrolling: true });
      window.clearTimeout(inertiaTimer.current);
      inertiaTimer.current = window.setTimeout(
        () => updateChromeGuards({ inertialScrolling: false }),
        320,
      );
      if ((event.ctrlKey || event.metaKey) && settings.ctrlWheelZoom) {
        event.preventDefault();
        updateSettings({ zoom: zoomFromWheel(settings.zoom, event.deltaY) });
        return;
      }
      if (settings.mode === "scroll" || !settings.wheelPageTurn) {
        return;
      }
      const pageTurn = wheelPageTurnDirection(event.deltaX, event.deltaY, settings.direction);
      if (pageTurn !== 0) {
        event.preventDefault();
        const now = Date.now();
        if (canTriggerWheelPageTurn(lastWheelPageTurnAt.current, now)) {
          lastWheelPageTurnAt.current = now;
          void (pageTurn > 0 ? next() : previous());
        }
      }
    },
    [
      next,
      previous,
      settings.direction,
      settings.mode,
      settings.ctrlWheelZoom,
      settings.wheelPageTurn,
      settings.zoom,
      updateChromeGuards,
      updateSettings,
    ],
  );

  if (!book) {
    return (
      <section className="flex flex-1 items-center justify-center bg-background">
        <div className="text-center text-foreground/65">
          <div className="text-lg font-semibold text-foreground">{t("noBookOpen")}</div>
          <div className="mt-2 text-sm">{t("noBookBody")}</div>
        </div>
      </section>
    );
  }

  const isBookmarked = bookmarks.some((bookmark) => bookmark.pageIndex === currentPage);
  const activeChapter = chapters
    .slice()
    .reverse()
    .find((chapter) => chapter.startPage <= currentPage);
  const jumpToPageInput = () => {
    const nextPage = Number.parseInt(pageInput, 10);
    if (Number.isFinite(nextPage)) void goToPage(nextPage - 1);
  };
  const leftNavigationLabel = settings.direction === "rtl" ? t("nextPage") : t("previousPage");
  const rightNavigationLabel = settings.direction === "rtl" ? t("previousPage") : t("nextPage");

  return (
    <section
      ref={readerRef}
      className="relative flex h-full min-w-0 flex-1 flex-col"
      style={{ background: settings.background }}
      onPointerMove={handleContentPointerMove}
      data-reader-presentation={presentation}
      data-reader-chrome={ui.chrome}
      data-reader-overlay={ui.overlay ?? "none"}
      data-reader-controls-layout={controlsOverlay ? "overlay" : "reserved"}
      data-reader-requested-page={requestedPage}
      data-reader-loading-page={loadingPage ?? "none"}
      data-reader-committed-page={committedPage}
      data-reader-focus-reading={focusReadingActive ? "true" : "false"}
      data-reader-focus-transition={focusTransition}
    >
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {presentationAnnouncement}
      </div>
      <header
        className={cn(
          "absolute left-0 right-0 top-0 z-20 flex h-14 items-center gap-2 overflow-x-auto border-b border-border bg-panel/95 px-4 backdrop-blur transition motion-reduce:transition-none",
          !topChromeVisible && "pointer-events-none -translate-y-full opacity-0",
        )}
        data-reader-control
        onPointerEnter={() => updateChromeGuards({ pointerOverControls: true })}
        onPointerLeave={() => updateChromeGuards({ pointerOverControls: false })}
        onFocusCapture={() => updateChromeGuards({ focusWithinControls: true })}
        onBlurCapture={(event) => {
          const region = event.currentTarget;
          window.setTimeout(() => {
            if (!region.contains(document.activeElement)) {
              updateChromeGuards({ focusWithinControls: false });
            }
          }, 0);
        }}
      >
        <Button
          title={returnLocation === "recent" ? t("returnRecent") : t("returnLibrary")}
          size="sm"
          onClick={() => void returnToSource()}
        >
          {returnLocation === "recent" ? <History size={17} /> : <Library size={17} />}
          <span className="hidden xl:inline">
            {returnLocation === "recent" ? t("returnRecent") : t("returnLibrary")}
          </span>
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{book.title}</div>
        </div>
        {chapters.length > 0 && (
          <select
            title={t("chapterTitle")}
            aria-label={t("chapterTitle")}
            className="h-9 max-w-56 rounded-md border border-border bg-panelMuted px-2 text-xs text-foreground outline-none focus:border-accent"
            value={activeChapter?.id ?? chapters[0]?.id}
            onChange={(event) => {
              const chapter = chapters.find((item) => item.id === Number(event.target.value));
              if (chapter) void goToPage(chapter.startPage);
            }}
          >
            {chapters.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.chapterNumber ? `${t("chapterShort")} ${chapter.chapterNumber} · ` : ""}
                {chapter.title}
              </option>
            ))}
          </select>
        )}
        <select
          title={t("readingMode")}
          aria-label={t("readingMode")}
          className="h-9 rounded-md border border-border bg-panelMuted px-2 text-xs text-foreground outline-none focus:border-accent"
          value={settings.mode}
          onChange={(event) => updateSettings({ mode: event.target.value as typeof settings.mode })}
        >
          <option value="single">{t("singlePage")}</option>
          <option value="double">{t("doublePage")}</option>
          <option value="scroll">{t("scroll")}</option>
        </select>
        <Button
          title={t("direction")}
          size="sm"
          onClick={() =>
            updateSettings({ direction: settings.direction === "ltr" ? "rtl" : "ltr" })
          }
        >
          {directionLabel(settings.direction)}
        </Button>
        <Button
          title={t("bookmark")}
          size="icon"
          variant={isBookmarked ? "primary" : "subtle"}
          onClick={() => void toggleBookmark()}
        >
          <Bookmark size={17} fill={isBookmarked ? "currentColor" : "none"} />
        </Button>
        <Button
          title={focusReadingActive ? t("exitFocusReading") : t("enterFocusReading")}
          size="sm"
          variant={focusReadingActive ? "primary" : "subtle"}
          aria-pressed={focusReadingActive}
          disabled={focusTransition !== "idle"}
          data-focus-reading-button
          className="motion-reduce:transform-none motion-reduce:transition-none"
          onClick={() => void toggleFocusReading()}
        >
          {focusReadingActive ? <Minimize size={17} /> : <Maximize size={17} />}
          <span className="hidden xl:inline">
            {focusReadingActive ? t("exitFocusReading") : t("focusReading")}
          </span>
        </Button>
        <Button
          title={t("moreActions")}
          size="icon"
          variant={moreMenuOpen ? "primary" : "subtle"}
          aria-pressed={moreMenuOpen}
          onClick={() => (moreMenuOpen ? dismissOverlay() : openOverlay("more"))}
        >
          <MoreHorizontal size={18} />
        </Button>
      </header>

      {error && (
        <div
          className="absolute left-4 top-20 z-30 flex items-center gap-3 rounded-md bg-danger px-3 py-2 text-sm"
          onPointerEnter={() => updateChromeGuards({ pointerOverControls: true })}
          onPointerLeave={() => updateChromeGuards({ pointerOverControls: false })}
        >
          <span>{error}</span>
          <Button size="sm" variant="subtle" onClick={() => void retryCurrentPage()}>
            {t("retry")}
          </Button>
        </div>
      )}

      {!error && loadingPage !== null && committedFrames.length > 0 && (
        <div
          className="pointer-events-none absolute right-4 top-20 z-10 flex items-center gap-2 rounded-md border border-border bg-panel/90 px-3 py-2 text-xs text-foreground/70 shadow-lg backdrop-blur"
          role="status"
          aria-live="polite"
          data-reader-loading-indicator
        >
          <RefreshCw size={14} className="animate-spin" />
          <span>{t("loadingPage")}</span>
        </div>
      )}

      {moreMenuOpen && (
        <div
          ref={(node) => {
            overlayRef.current = node;
          }}
          role="menu"
          aria-label={t("moreActions")}
          className="absolute right-4 top-16 z-30 w-60 rounded-md border border-border bg-panel p-2 shadow-2xl"
          data-reader-control
          onPointerEnter={() => updateChromeGuards({ pointerOverControls: true })}
          onPointerLeave={() => updateChromeGuards({ pointerOverControls: false })}
          onFocusCapture={() => updateChromeGuards({ focusWithinControls: true })}
          onBlurCapture={(event) => {
            const region = event.currentTarget;
            window.setTimeout(() => {
              if (!region.contains(document.activeElement)) {
                updateChromeGuards({ focusWithinControls: false });
              }
            }, 0);
          }}
        >
          <MenuButton
            icon={fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
            label={fullscreen ? t("exitSystemFullscreen") : t("systemFullscreen")}
            onClick={() => {
              dismissOverlay();
              void toggleSystemFullscreen();
            }}
          />
          <MenuButton
            icon={<SlidersHorizontal size={16} />}
            label={t("imageAdjustments")}
            onClick={() => openOverlay("image")}
          />
          {settings.night && (
            <MenuButton
              icon={<AlertTriangle size={16} />}
              label={t("advancedImageEffectActive")}
              onClick={() => openOverlay("advanced-image")}
            />
          )}
          <MenuButton
            icon={<WandSparkles size={16} />}
            label={t("preferEnhanced")}
            pressed={settings.preferEnhanced}
            onClick={() => updateSettings({ preferEnhanced: !settings.preferEnhanced })}
          />
          <MenuButton
            icon={<List size={16} />}
            label={t("bookmarkList")}
            onClick={() => openOverlay("bookmarks")}
          />
          {settings.mode === "double" && (
            <MenuButton
              icon={<BookOpen size={16} />}
              label={t("coverSingle")}
              pressed={settings.coverSingle}
              onClick={() => updateSettings({ coverSingle: !settings.coverSingle })}
            />
          )}
          <MenuButton
            icon={
              presentation === "immersive" || presentation === "focus" ? (
                <Eye size={16} />
              ) : (
                <EyeOff size={16} />
              )
            }
            label={
              presentation === "immersive" || presentation === "focus"
                ? t("exitImmersiveMode")
                : t("immersiveMode")
            }
            onClick={() => void toggleImmersive()}
          />
          <MenuButton
            icon={<CircleHelp size={16} />}
            label={t("readerHelp")}
            onClick={() => openOverlay("tutorial")}
          />
        </div>
      )}

      {bookmarkPanelOpen && (
        <div
          ref={(node) => {
            overlayRef.current = node;
          }}
          role="dialog"
          aria-label={t("bookmarkList")}
          className="absolute right-4 top-16 z-30 w-56 rounded-md border border-border bg-panel p-2 shadow-2xl"
          onPointerEnter={() => updateChromeGuards({ pointerOverControls: true, panelOpen: true })}
          onPointerLeave={() => updateChromeGuards({ pointerOverControls: false })}
          onFocusCapture={() => updateChromeGuards({ focusWithinControls: true, panelOpen: true })}
          onBlurCapture={(event) => {
            const region = event.currentTarget;
            window.setTimeout(() => {
              if (!region.contains(document.activeElement)) {
                updateChromeGuards({ focusWithinControls: false });
              }
            }, 0);
          }}
        >
          <div className="px-2 py-1.5 text-xs font-semibold text-foreground/60">
            {t("bookmarkList")}
          </div>
          {bookmarks.length === 0 ? (
            <div className="px-2 py-3 text-sm text-foreground/55">{t("noBookmarks")}</div>
          ) : (
            bookmarks
              .slice()
              .sort((left, right) => left.pageIndex - right.pageIndex)
              .map((bookmark) => (
                <button
                  key={bookmark.id}
                  className="flex w-full items-center justify-between rounded px-2 py-2 text-left text-sm hover:bg-panelMuted"
                  onClick={() => {
                    dismissOverlay();
                    void goToPage(bookmark.pageIndex);
                  }}
                >
                  <span>
                    {t("page")} {bookmark.pageIndex + 1}
                  </span>
                  <Bookmark size={14} />
                </button>
              ))
          )}
        </div>
      )}

      <main
        className={cn(
          "reader-scrollbar flex-1 select-none overflow-auto",
          readerViewportSpacing(resolvedControlsLayout),
          settings.mode === "scroll"
            ? "overflow-hidden px-0"
            : "flex items-center justify-center px-12",
        )}
        onWheel={handleWheel}
        onPointerDown={handleContentPointerDown}
        onPointerUp={handleContentPointerUp}
        onPointerCancel={cancelContentGesture}
      >
        {committedFrames.length === 0 ? (
          <PageLoadingShell label={t("loadingBook")} />
        ) : settings.mode === "scroll" ? (
          <Virtuoso
            key={book.id}
            ref={scrollRef}
            className="reader-scrollbar"
            style={{ height: "100%" }}
            totalCount={pages.length}
            initialTopMostItemIndex={currentPage}
            increaseViewportBy={{ top: 900, bottom: 900 }}
            rangeChanged={({ startIndex, endIndex }) => {
              const pageIndex = visibleRangePage(startIndex, endIndex, pages.length);
              if (pageIndex !== currentPage) {
                scrollDrivenPage.current = pageIndex;
                void goToPage(pageIndex);
              }
            }}
            itemContent={(pageIndex) => (
              <div className="mx-auto flex max-w-5xl justify-center px-3 py-2">
                <ReaderImage
                  frame={pageCache.get(pageIndex)}
                  pageIndex={pageIndex}
                  fit={settings.fit}
                  zoom={settings.zoom}
                  filter={filter}
                  rotation={settings.rotation}
                  controlsReserved={controlsReserved}
                  scroll
                />
              </div>
            )}
            components={{ Footer: () => <div className="h-56" /> }}
          />
        ) : (
          <div
            className={cn(
              "flex gap-4",
              controlsReserved ? "max-h-[calc(100vh-7rem)]" : "max-h-[calc(100vh-1rem)]",
              settings.direction === "rtl" && "flex-row-reverse",
            )}
            data-testid="reader-committed-frame"
          >
            {committedFrames.map((frame) => (
              <ReaderImage
                key={frame.cacheKey}
                frame={frame}
                pageIndex={frame.pageIndex}
                fit={settings.fit}
                zoom={settings.zoom}
                filter={filter}
                rotation={settings.rotation}
                controlsReserved={controlsReserved}
                panOffset={panOffset}
              />
            ))}
          </div>
        )}
      </main>

      <button
        className={cn(
          "absolute left-3 top-1/2 z-10 flex h-20 w-10 -translate-y-1/2 items-center justify-center rounded-md bg-panel/70 transition hover:bg-panel",
          !sideControlsVisible && "pointer-events-none opacity-0",
        )}
        onClick={() => void (settings.direction === "rtl" ? next() : previous())}
        onPointerEnter={() => updateChromeGuards({ pointerOverControls: true })}
        onPointerLeave={() => updateChromeGuards({ pointerOverControls: false })}
        onFocus={() => updateChromeGuards({ focusWithinControls: true })}
        onBlur={() => updateChromeGuards({ focusWithinControls: false })}
        aria-label={leftNavigationLabel}
        title={leftNavigationLabel}
      >
        <ChevronLeft />
      </button>
      <button
        className={cn(
          "absolute right-3 top-1/2 z-10 flex h-20 w-10 -translate-y-1/2 items-center justify-center rounded-md bg-panel/70 transition hover:bg-panel",
          !sideControlsVisible && "pointer-events-none opacity-0",
        )}
        onClick={() => void (settings.direction === "rtl" ? previous() : next())}
        onPointerEnter={() => updateChromeGuards({ pointerOverControls: true })}
        onPointerLeave={() => updateChromeGuards({ pointerOverControls: false })}
        onFocus={() => updateChromeGuards({ focusWithinControls: true })}
        onBlur={() => updateChromeGuards({ focusWithinControls: false })}
        aria-label={rightNavigationLabel}
        title={rightNavigationLabel}
      >
        <ChevronRight />
      </button>

      <footer
        className={cn(
          "absolute bottom-0 left-0 right-0 z-20 border-t border-border bg-panel/95 px-4 py-3 backdrop-blur transition motion-reduce:transition-none",
          !bottomChromeVisible && "pointer-events-none translate-y-full opacity-0",
        )}
        data-reader-control
        onPointerEnter={() => updateChromeGuards({ pointerOverControls: true })}
        onPointerLeave={() => updateChromeGuards({ pointerOverControls: false })}
        onFocusCapture={() => updateChromeGuards({ focusWithinControls: true })}
        onBlurCapture={(event) => {
          const region = event.currentTarget;
          window.setTimeout(() => {
            if (!region.contains(document.activeElement)) {
              updateChromeGuards({ focusWithinControls: false });
            }
          }, 0);
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="shrink-0 whitespace-nowrap text-xs text-foreground/65">
            {t("page")} {Math.min(currentPage + 1, pages.length)} / {pages.length}
          </div>
          <form
            className="flex w-16 shrink-0 items-center text-xs text-foreground/60"
            onSubmit={(event) => {
              event.preventDefault();
              jumpToPageInput();
            }}
          >
            <input
              aria-label={t("pageNumber")}
              className="h-8 w-14 rounded-md border border-border bg-background px-2 text-right text-foreground outline-none focus:border-accent"
              inputMode="numeric"
              min={1}
              max={Math.max(1, pages.length)}
              type="number"
              value={pageInput}
              onFocus={() => updateChromeGuards({ pageInputActive: true })}
              onBlur={() => {
                jumpToPageInput();
                updateChromeGuards({ pageInputActive: false });
              }}
              onChange={(event) => setPageInput(event.target.value)}
            />
          </form>
          <Slider.Root
            className="relative flex h-5 flex-1 touch-none items-center"
            min={0}
            max={Math.max(0, pages.length - 1)}
            value={[currentPage]}
            onPointerDown={() => updateChromeGuards({ draggingControl: true })}
            onValueCommit={([value]) => void goToPage(value)}
            onPointerUp={() => updateChromeGuards({ draggingControl: false })}
            onPointerCancel={() => updateChromeGuards({ draggingControl: false })}
          >
            <Slider.Track className="relative h-1 flex-1 rounded-full bg-panelMuted">
              <Slider.Range className="absolute h-full rounded-full bg-accent" />
            </Slider.Track>
            <Slider.Thumb className="block h-4 w-4 rounded-full bg-accent shadow-focus" />
          </Slider.Root>
          <Button
            title={t("thumbnailNavigation")}
            size="sm"
            variant={thumbnailsOpen ? "primary" : "subtle"}
            aria-pressed={thumbnailsOpen}
            onClick={() => (thumbnailsOpen ? dismissOverlay() : openOverlay("thumbnails"))}
          >
            <Images size={16} />
            {t("thumbnailNavigation")}
          </Button>
          <Button
            title={t("zoomOut")}
            size="icon"
            onClick={() => updateSettings({ zoom: clampZoom(settings.zoom - 10) })}
          >
            <ZoomOut size={16} />
          </Button>
          <div className="flex h-8 min-w-14 items-center justify-center rounded-md border border-border bg-panelMuted px-2 text-xs text-foreground/75">
            {settings.zoom}%
          </div>
          <Button
            title={t("zoomIn")}
            size="icon"
            onClick={() => updateSettings({ zoom: clampZoom(settings.zoom + 10) })}
          >
            <ZoomIn size={16} />
          </Button>
          <Button
            title={fitLabel(settings.fit)}
            size="sm"
            onClick={() =>
              updateSettings({
                fit:
                  settings.fit === "width"
                    ? "height"
                    : settings.fit === "height"
                      ? "original"
                      : "width",
              })
            }
          >
            {fitLabel(settings.fit)}
          </Button>
        </div>
        {settings.night && (
          <button
            type="button"
            className="mt-2 inline-flex h-8 items-center gap-2 rounded-md border border-amber-500/60 bg-amber-500/10 px-2.5 text-xs text-foreground hover:bg-amber-500/20"
            onClick={() => openOverlay("advanced-image")}
            aria-label={t("advancedImageEffectActive")}
            title={t("advancedImageEffectActive")}
          >
            <AlertTriangle size={15} className="text-amber-400" />
            {t("advancedImageEffectActive")}
          </button>
        )}
        {thumbnailsOpen && (
          <div
            ref={(node) => {
              overlayRef.current = node;
            }}
            role="dialog"
            aria-label={t("thumbnailNavigation")}
          >
            <ThumbnailFilmstrip
              bookId={book.id}
              pageCount={pages.length}
              currentPage={currentPage}
              lowMemory={settings.lowMemory}
              onJump={(page) => void goToPage(page)}
            />
          </div>
        )}
        {imagePanelOpen && (
          <div
            ref={(node) => {
              overlayRef.current = node;
            }}
            role="dialog"
            aria-label={t("imageAdjustments")}
            className="absolute bottom-[calc(100%+0.5rem)] right-4 z-30 w-[min(420px,calc(100vw-2rem))] rounded-md border border-border bg-panel p-4 shadow-2xl"
            onPointerEnter={() =>
              updateChromeGuards({ pointerOverControls: true, panelOpen: true })
            }
            onPointerLeave={() => updateChromeGuards({ pointerOverControls: false })}
            onFocusCapture={() =>
              updateChromeGuards({ focusWithinControls: true, panelOpen: true })
            }
            onBlurCapture={(event) => {
              const region = event.currentTarget;
              window.setTimeout(() => {
                if (!region.contains(document.activeElement)) {
                  updateChromeGuards({ focusWithinControls: false });
                }
              }, 0);
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold">{t("imageAdjustments")}</div>
              <div className="flex items-center gap-2">
                {imageAdjustmentsChanged && (
                  <span className="text-xs text-foreground/55">
                    {t("imageAdjustmentsModified")}
                  </span>
                )}
                <Button size="sm" variant="subtle" onClick={resetImageAdjustments}>
                  <RefreshCw size={15} />
                  {t("resetImageAdjustments")}
                </Button>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-[80px_minmax(0,1fr)] items-center gap-x-3 gap-y-3 text-xs text-foreground/60">
              <span>{t("brightness")}</span>
              <MiniSlider
                label={t("brightness")}
                value={settings.brightness}
                min={50}
                max={150}
                onInteraction={(dragging) => updateChromeGuards({ draggingControl: dragging })}
                onValue={(brightness) => updateSettings({ brightness })}
              />
              <span>{t("contrast")}</span>
              <MiniSlider
                label={t("contrast")}
                value={settings.contrast}
                min={50}
                max={150}
                onInteraction={(dragging) => updateChromeGuards({ draggingControl: dragging })}
                onValue={(contrast) => updateSettings({ contrast })}
              />
              <span>{t("saturation")}</span>
              <MiniSlider
                label={t("saturation")}
                value={settings.saturation}
                min={0}
                max={180}
                onInteraction={(dragging) => updateChromeGuards({ draggingControl: dragging })}
                onValue={(saturation) => updateSettings({ saturation })}
              />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                title={t("gray")}
                size="sm"
                variant={settings.grayscale ? "primary" : "subtle"}
                onClick={() => updateSettings({ grayscale: !settings.grayscale })}
              >
                {t("gray")}
              </Button>
              <Button
                title={t("sharpen")}
                size="sm"
                variant={settings.sharpen ? "primary" : "subtle"}
                onClick={() => updateSettings({ sharpen: !settings.sharpen })}
              >
                <Sparkles size={16} />
                {t("sharpen")}
              </Button>
              <Button
                title={t("trimWhite")}
                size="sm"
                variant={settings.trimWhite ? "primary" : "subtle"}
                onClick={() => updateSettings({ trimWhite: !settings.trimWhite })}
              >
                <Scissors size={16} />
                {t("trimWhite")}
              </Button>
              <Button
                title={t("rotate")}
                size="sm"
                onClick={() => updateSettings({ rotation: (settings.rotation + 90) % 360 })}
              >
                <RotateCw size={16} />
                {t("rotate")}
              </Button>
              <label
                className="flex h-8 cursor-pointer items-center justify-center gap-2 rounded-md border border-border bg-panelMuted px-2.5 text-sm hover:bg-panel"
                title={t("backgroundColor")}
              >
                <Palette size={16} />
                {t("backgroundColor")}
                <input
                  aria-label={t("backgroundColor")}
                  className="sr-only"
                  type="color"
                  value={settings.background}
                  onChange={(event) => updateSettings({ background: event.target.value })}
                />
              </label>
            </div>
          </div>
        )}
        {advancedImagePanelOpen && (
          <div
            ref={(node) => {
              overlayRef.current = node;
            }}
            role="dialog"
            aria-label={t("advancedImageEffects")}
            className="absolute bottom-[calc(100%+0.5rem)] right-4 z-30 w-[min(380px,calc(100vw-2rem))] rounded-md border border-amber-500/60 bg-panel p-4 shadow-2xl"
            onPointerEnter={() =>
              updateChromeGuards({ pointerOverControls: true, panelOpen: true })
            }
            onPointerLeave={() => updateChromeGuards({ pointerOverControls: false })}
            onFocusCapture={() =>
              updateChromeGuards({ focusWithinControls: true, panelOpen: true })
            }
            onBlurCapture={(event) => {
              const region = event.currentTarget;
              window.setTimeout(() => {
                if (!region.contains(document.activeElement)) {
                  updateChromeGuards({ focusWithinControls: false });
                }
              }, 0);
            }}
          >
            <div className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle size={17} className="text-amber-400" />
              {t("advancedImageEffects")}
            </div>
            <p className="mt-2 text-sm leading-6 text-foreground/65">
              {t("legacyInvertCompatibilityDescription")}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="primary" size="sm" onClick={() => updateSettings({ night: false })}>
                {t("disableInvert")}
              </Button>
              <Button size="sm" variant="subtle" onClick={resetImageAdjustments}>
                <RefreshCw size={15} />
                {t("resetImageAdjustments")}
              </Button>
            </div>
          </div>
        )}
      </footer>

      {tutorialOpen && (
        <div
          className="absolute inset-0 z-50 bg-black/65 text-white"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reader-tutorial-title"
          data-reader-control
          onPointerDown={(event) => {
            if (event.currentTarget === event.target) dismissOverlay();
          }}
        >
          <div className="pointer-events-none absolute inset-x-3 top-3 rounded-md border border-white/30 bg-black/55 px-3 py-2 text-center text-sm">
            {t("tutorialTopZone")}
          </div>
          <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded-md border border-white/30 bg-black/55 px-3 py-2 text-center text-sm">
            {t("tutorialBottomZone")}
          </div>
          <div className="pointer-events-none absolute left-[8%] top-1/2 -translate-y-1/2 text-center text-sm font-medium">
            <ChevronLeft className="mx-auto mb-2" />
            {settings.direction === "rtl" ? t("nextPage") : t("previousPage")}
          </div>
          <div className="pointer-events-none absolute right-[8%] top-1/2 -translate-y-1/2 text-center text-sm font-medium">
            <ChevronRight className="mx-auto mb-2" />
            {settings.direction === "rtl" ? t("previousPage") : t("nextPage")}
          </div>
          <div
            ref={(node) => {
              overlayRef.current = node;
            }}
            className="absolute left-1/2 top-1/2 w-[min(420px,72vw)] -translate-x-1/2 -translate-y-1/2 rounded-md border border-white/25 bg-panel p-5 text-foreground shadow-2xl"
          >
            <h2 id="reader-tutorial-title" className="text-base font-semibold">
              {t("readerTutorialTitle")}
            </h2>
            <p className="mt-2 text-sm text-foreground/70">{t("tutorialCenterZone")}</p>
            <p className="mt-3 text-xs leading-5 text-foreground/60">
              {t("focusReadingGuideSummary")}
            </p>
            <p className="mt-3 text-xs leading-5 text-foreground/60">{t("tutorialShortcuts")}</p>
            <button
              ref={overlayFocusRef}
              type="button"
              className="mt-4 h-10 w-full rounded-md border border-transparent bg-accent px-3 text-sm text-accentText hover:bg-accent/90"
              onClick={dismissOverlay}
            >
              {t("tutorialDoNotShowAgain")}
            </button>
          </div>
        </div>
      )}

      {fullscreenHintOpen && (
        <div
          className="absolute inset-0 z-50 bg-black/35"
          role="dialog"
          aria-modal="true"
          aria-labelledby="fullscreen-hint-title"
          data-reader-control
          onPointerDown={(event) => {
            if (event.currentTarget === event.target) dismissOverlay();
          }}
        >
          <div
            ref={(node) => {
              overlayRef.current = node;
            }}
            className="absolute left-1/2 top-4 w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 rounded-md border border-border bg-panel p-4 text-foreground shadow-2xl"
          >
            <h2 id="fullscreen-hint-title" className="text-sm font-semibold">
              {t("fullscreenHintTitle")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-foreground/70">{t("fullscreenHintBody")}</p>
            <button
              ref={overlayFocusRef}
              type="button"
              className="mt-3 h-8 rounded-md border border-transparent bg-accent px-3 text-sm text-accentText hover:bg-accent/90"
              onClick={dismissOverlay}
            >
              {t("tutorialDoNotShowAgain")}
            </button>
          </div>
        </div>
      )}

      {focusPromptOpen && (
        <div
          className="absolute inset-0 z-50 bg-black/35"
          role="dialog"
          aria-modal="true"
          aria-labelledby="focus-prompt-title"
          data-reader-control
          onPointerDown={(event) => {
            if (event.currentTarget === event.target) dismissOverlay();
          }}
        >
          <div
            ref={(node) => {
              overlayRef.current = node;
            }}
            className="absolute left-1/2 top-1/2 w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-panel p-5 text-foreground shadow-2xl"
          >
            <h2 id="focus-prompt-title" className="text-base font-semibold">
              {t("focusReadingNeedsClickTitle")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-foreground/70">
              {t("focusReadingNeedsClickBody")}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={dismissOverlay}>
                {t("cancel")}
              </Button>
              <button
                ref={overlayFocusRef}
                type="button"
                className="inline-flex h-8 items-center rounded-md bg-accent px-2.5 text-sm text-accentText hover:bg-accent/90"
                onClick={() => void enterFocusReading("prompt")}
              >
                {t("enterFocusReading")}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function isEditableTarget(target: HTMLElement): boolean {
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
}

function isInteractiveTarget(target: globalThis.EventTarget | null): boolean {
  if (!(target instanceof globalThis.Element)) return false;
  return Boolean(
    target.closest(
      "button, a, input, select, textarea, [role='slider'], [role='menuitem'], [data-reader-control]",
    ),
  );
}

function hasKeyboardControlFocus(): boolean {
  const active = document.activeElement;
  return (
    active instanceof HTMLElement &&
    (isEditableTarget(active) || (isInteractiveTarget(active) && active.matches(":focus-visible")))
  );
}

function MenuButton({
  icon,
  label,
  pressed,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-panelMuted"
      aria-pressed={pressed}
      onClick={onClick}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {pressed && <span className="text-xs text-accent">{t("enabled")}</span>}
    </button>
  );
}

function directionLabel(direction: string): string {
  return direction === "rtl" ? t("directionRtl") : t("directionLtr");
}

function fitLabel(fit: string): string {
  if (fit === "height") return t("fitHeight");
  if (fit === "original") return t("fitOriginal");
  return t("fitWidth");
}

function PageLoadingShell({ label }: { label: string }) {
  return (
    <div className="flex h-[72vh] w-[48vh] animate-pulse items-center justify-center rounded-md bg-panelMuted px-4 text-center text-sm text-foreground/55">
      {label}
    </div>
  );
}

function ReaderImage({
  frame,
  pageIndex,
  fit,
  zoom,
  filter,
  rotation,
  controlsReserved,
  panOffset,
  scroll = false,
}: {
  frame?: DecodedPageFrame;
  pageIndex: number;
  fit: string;
  zoom: number;
  filter: string;
  rotation: number;
  controlsReserved: boolean;
  panOffset?: { x: number; y: number };
  scroll?: boolean;
}) {
  const stableScrollRatio = useRef(frame ? `${frame.width} / ${frame.height}` : "2 / 3");

  if (scroll) {
    return (
      <div
        className="relative w-full max-w-5xl overflow-hidden bg-panelMuted"
        style={{ aspectRatio: stableScrollRatio.current }}
        data-scroll-page={pageIndex}
        data-scroll-page-height-stable="true"
      >
        {frame ? (
          <img
            src={frame.dataUrl}
            data-reader-page={pageIndex}
            data-reader-cache-key={frame.cacheKey}
            draggable={false}
            className="absolute inset-0 h-full w-full select-none object-contain"
            style={{
              filter,
              transform: `rotate(${rotation}deg) scale(${zoom / 100})`,
              transformOrigin: "center center",
            }}
            alt=""
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-foreground/45">
            {t("loadingPage")}
          </div>
        )}
      </div>
    );
  }
  if (!frame) {
    return <PageLoadingShell label={t("loadingPage")} />;
  }
  return (
    <img
      src={frame.dataUrl}
      data-reader-page={pageIndex}
      data-reader-cache-key={frame.cacheKey}
      draggable={false}
      className={cn(
        "select-none object-contain shadow-2xl",
        fit === "width" && "w-full max-w-5xl",
        fit === "height" &&
          (controlsReserved
            ? "max-h-[calc(100vh-7rem)] w-auto"
            : "max-h-[calc(100vh-1rem)] w-auto"),
        fit === "original" && "h-auto w-auto max-w-none",
      )}
      style={{
        filter,
        transform: `translate(${panOffset?.x ?? 0}px, ${panOffset?.y ?? 0}px) rotate(${rotation}deg) scale(${zoom / 100})`,
        transformOrigin: "center center",
      }}
      alt=""
    />
  );
}

function MiniSlider({
  label,
  value,
  min,
  max,
  onValue,
  onInteraction,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onValue: (value: number) => void;
  onInteraction?: (dragging: boolean) => void;
}) {
  return (
    <Slider.Root
      className="relative flex h-4 touch-none items-center"
      min={min}
      max={max}
      value={[value]}
      onPointerDown={() => onInteraction?.(true)}
      onPointerCancel={() => onInteraction?.(false)}
      onValueChange={([next]) => onValue(next)}
      onValueCommit={() => onInteraction?.(false)}
    >
      <Slider.Track className="relative h-1 flex-1 rounded-full bg-panelMuted">
        <Slider.Range className="absolute h-full rounded-full bg-accent" />
      </Slider.Track>
      <Slider.Thumb
        aria-label={label}
        className="block h-3.5 w-3.5 rounded-full bg-accent shadow-focus"
      />
    </Slider.Root>
  );
}
