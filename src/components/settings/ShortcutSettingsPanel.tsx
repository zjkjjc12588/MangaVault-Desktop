import {
  AlertTriangle,
  Keyboard,
  LockKeyhole,
  MousePointer2,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getUiLocale } from "../../lib/i18n";
import type { ReaderSettings } from "../../lib/types";
import {
  SHORTCUT_SETTINGS_KEY,
  addShortcutBinding,
  beginShortcutCapture,
  effectiveShortcutBindings,
  exportShortcutUserBindings,
  findShortcutConflicts,
  formatShortcutBinding,
  removeShortcutBinding,
  resetAllShortcutCommands,
  resetShortcutCommand,
  shortcutBindingFromEvent,
  shortcutCommandText,
  syncShortcutBindings,
  validateShortcutBinding,
  type ShortcutBinding,
  type ShortcutCategory,
  type ShortcutConflict,
} from "../../shortcuts/shortcutRegistry";
import { useShortcutRegistrySnapshot } from "../../shortcuts/useShortcut";
import { useReaderStore } from "../../stores/readerStore";
import { Button } from "../ui/Button";

interface ShortcutSettingsPanelProps {
  settings: Record<string, unknown>;
  onPersist: (key: string, value: unknown) => Promise<boolean>;
}

const readerGestureKeys = {
  sideClickPaging: "reader.pointer.side_paging",
  centerClickControls: "reader.pointer.center_controls",
  doubleClickZoom: "reader.pointer.double_click_zoom",
  doubleClickInterval: "reader.pointer.double_click_interval",
  ctrlWheelZoom: "reader.pointer.ctrl_wheel_zoom",
  wheelPageTurn: "reader.pointer.wheel_page_turn",
  dragPan: "reader.pointer.drag_pan",
} satisfies Record<
  keyof Pick<
    ReaderSettings,
    | "sideClickPaging"
    | "centerClickControls"
    | "doubleClickZoom"
    | "doubleClickInterval"
    | "ctrlWheelZoom"
    | "wheelPageTurn"
    | "dragPan"
  >,
  string
>;

export function ShortcutSettingsPanel({ settings, onPersist }: ShortcutSettingsPanelProps) {
  const locale = getUiLocale();
  const zh = locale === "zh-CN";
  const registry = useShortcutRegistrySnapshot();
  const [recordingCommand, setRecordingCommand] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<ShortcutBinding | null>(null);
  const [conflicts, setConflicts] = useState<ShortcutConflict[]>([]);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const persistRegistryChange = useCallback(
    async (previous: Record<string, ShortcutBinding[]>) => {
      setSaving(true);
      const saved = await onPersist(SHORTCUT_SETTINGS_KEY, exportShortcutUserBindings());
      setSaving(false);
      if (!saved) syncShortcutBindings(previous);
      return saved;
    },
    [onPersist],
  );

  const saveCandidate = useCallback(
    async (replaceConflicts: boolean) => {
      if (!recordingCommand || !candidate) return;
      const previous = exportShortcutUserBindings();
      try {
        addShortcutBinding(recordingCommand, candidate, replaceConflicts);
        if (await persistRegistryChange(previous)) {
          setRecordingCommand(null);
          setCandidate(null);
          setConflicts([]);
          setCaptureError(null);
        }
      } catch (error) {
        syncShortcutBindings(previous);
        setCaptureError(shortcutErrorText(String(error), zh));
      }
    },
    [candidate, persistRegistryChange, recordingCommand, zh],
  );

  useEffect(() => {
    if (!recordingCommand) return;
    return beginShortcutCapture((event) => {
      if (event.key === "Escape") {
        setRecordingCommand(null);
        setCandidate(null);
        setConflicts([]);
        setCaptureError(null);
        return true;
      }
      const binding = shortcutBindingFromEvent(event);
      if (!binding) {
        setCaptureError(zh ? "请同时按下一个非修饰键。" : "Press a non-modifier key as well.");
        return true;
      }
      const validationError = validateShortcutBinding(binding);
      if (validationError) {
        setCandidate(binding);
        setConflicts([]);
        setCaptureError(shortcutErrorText(validationError, zh));
        return true;
      }
      const nextConflicts = findShortcutConflicts(recordingCommand, binding);
      setCandidate(binding);
      setConflicts(nextConflicts);
      setCaptureError(null);
      if (nextConflicts.length === 0) void saveRecordedBinding(recordingCommand, binding);
      return true;
    });

    async function saveRecordedBinding(commandId: string, binding: ShortcutBinding) {
      const previous = exportShortcutUserBindings();
      try {
        addShortcutBinding(commandId, binding);
        if (await persistRegistryChange(previous)) {
          setRecordingCommand(null);
          setCandidate(null);
        }
      } catch (error) {
        syncShortcutBindings(previous);
        setCaptureError(shortcutErrorText(String(error), zh));
      }
    }
  }, [persistRegistryChange, recordingCommand, zh]);

  const grouped = useMemo(
    () =>
      (["global", "library", "reader", "display"] as ShortcutCategory[]).map((category) => ({
        category,
        commands: registry.commands.filter((command) => command.category === category),
      })),
    [registry.commands],
  );

  const mutateRegistry = async (mutation: () => void) => {
    const previous = exportShortcutUserBindings();
    try {
      mutation();
      await persistRegistryChange(previous);
    } catch (error) {
      syncShortcutBindings(previous);
      setCaptureError(shortcutErrorText(String(error), zh));
    }
  };

  const updateGestureSetting = async <Key extends keyof typeof readerGestureKeys>(
    key: Key,
    value: ReaderSettings[Key],
  ) => {
    const saved = await onPersist(readerGestureKeys[key], value);
    if (saved) {
      useReaderStore.setState((state) => ({
        settings: { ...state.settings, [key]: value },
      }));
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground/60">
            <Keyboard size={17} />
            {zh ? "键盘与快捷键" : "Keyboard & Shortcuts"}
          </h2>
          <p className="mt-1 text-xs text-foreground/50">
            {zh
              ? "快捷键只在 MangaVault 窗口内生效；可为一个操作添加多个按键。"
              : "Shortcuts work only inside MangaVault. One action can have multiple bindings."}
          </p>
        </div>
        <Button
          size="sm"
          variant="subtle"
          disabled={saving}
          data-testid="shortcut-reset-all"
          onClick={() => void mutateRegistry(resetAllShortcutCommands)}
        >
          <RotateCcw size={15} />
          {zh ? "全部恢复默认" : "Reset All"}
        </Button>
      </div>

      <div className="mt-4 space-y-5">
        {grouped.map(({ category, commands }) => (
          <div key={category}>
            <h3 className="mb-2 text-xs font-semibold text-foreground/55">
              {categoryText(category, zh)}
            </h3>
            <div className="divide-y divide-border border border-border bg-panel">
              {commands.map((command) => {
                const text = shortcutCommandText(command.commandId, locale);
                const bindings = effectiveShortcutBindings(command.commandId);
                return (
                  <div
                    key={command.commandId}
                    className="grid gap-3 p-3 md:grid-cols-[minmax(180px,1fr)_minmax(220px,1.4fr)_auto] md:items-center"
                    data-shortcut-command={command.commandId}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {text.name}
                        {!command.customizable && (
                          <LockKeyhole size={13} className="text-foreground/45" />
                        )}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-foreground/50">
                        {text.description}
                      </div>
                    </div>
                    <div className="flex min-h-8 flex-wrap items-center gap-1.5">
                      {bindings.map((binding) => (
                        <span
                          key={`${binding.normalizedKey}-${binding.code}-${formatShortcutBinding(binding)}`}
                          className="inline-flex h-7 items-center gap-1 border border-border bg-background px-2 font-mono text-xs"
                        >
                          {formatShortcutBinding(binding)}
                          {command.customizable && (
                            <button
                              type="button"
                              data-shortcut-remove={command.commandId}
                              className="ml-1 text-foreground/45 hover:text-danger"
                              aria-label={`${zh ? "删除" : "Remove"} ${formatShortcutBinding(binding)}`}
                              onClick={() =>
                                void mutateRegistry(() =>
                                  removeShortcutBinding(command.commandId, binding),
                                )
                              }
                            >
                              <X size={12} />
                            </button>
                          )}
                        </span>
                      ))}
                      {bindings.length === 0 && (
                        <span className="text-xs text-foreground/40">
                          {zh ? "未绑定" : "Unassigned"}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 md:justify-end">
                      {command.customizable ? (
                        <>
                          <Button
                            size="sm"
                            variant="subtle"
                            disabled={saving}
                            data-shortcut-add={command.commandId}
                            onClick={() => {
                              setCandidate(null);
                              setConflicts([]);
                              setCaptureError(null);
                              setRecordingCommand(command.commandId);
                            }}
                          >
                            <Plus size={14} />
                            {zh ? "添加" : "Add"}
                          </Button>
                          <Button
                            size="sm"
                            variant="subtle"
                            disabled={saving || command.userBindings === null}
                            data-shortcut-reset={command.commandId}
                            onClick={() =>
                              void mutateRegistry(() => resetShortcutCommand(command.commandId))
                            }
                          >
                            <RotateCcw size={14} />
                            {zh ? "默认" : "Default"}
                          </Button>
                        </>
                      ) : (
                        <span className="text-xs text-foreground/45">
                          {zh ? "固定安全操作" : "Fixed safety action"}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <MouseGestureSettings
        settings={settings}
        zh={zh}
        onChange={(key, value) => void updateGestureSetting(key, value)}
      />

      {recordingCommand && (
        <div
          className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={zh ? "录入快捷键" : "Record shortcut"}
          data-testid="shortcut-recorder"
          onPointerDown={(event) => {
            if (event.currentTarget === event.target) setRecordingCommand(null);
          }}
        >
          <div className="w-[min(480px,calc(100vw-2rem))] border border-border bg-panel p-5 shadow-2xl">
            <div className="text-sm font-semibold">
              {zh ? "按下新的快捷键" : "Press a new shortcut"}
            </div>
            <p className="mt-2 text-sm text-foreground/60">
              {shortcutCommandText(recordingCommand, locale).name}
            </p>
            <div className="mt-4 flex min-h-14 items-center justify-center border border-dashed border-border bg-background px-3 font-mono text-base">
              {candidate
                ? formatShortcutBinding(candidate)
                : zh
                  ? "等待按键，Esc 取消"
                  : "Waiting for keys; Esc cancels"}
            </div>
            {captureError && <p className="mt-3 text-sm text-danger">{captureError}</p>}
            {conflicts.length > 0 && candidate && (
              <div className="mt-3 border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  <AlertTriangle size={16} />
                  {zh ? "快捷键冲突" : "Shortcut conflict"}
                </div>
                <p className="mt-2 text-foreground/65">
                  {zh ? "当前由以下操作使用：" : "Currently used by:"}{" "}
                  {conflicts
                    .map((conflict) => shortcutCommandText(conflict.commandId, locale).name)
                    .join("、")}
                </p>
                <p className="mt-1 text-xs text-foreground/50">
                  {conflicts.map((conflict) => conflict.scope).join(" / ")}
                </p>
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="subtle" onClick={() => setRecordingCommand(null)}>
                {zh ? "取消" : "Cancel"}
              </Button>
              {conflicts.length > 0 && conflicts.every((conflict) => conflict.replaceable) && (
                <Button
                  size="sm"
                  variant="primary"
                  data-testid="shortcut-replace-conflict"
                  onClick={() => void saveCandidate(true)}
                >
                  {zh ? "替换现有绑定" : "Replace Existing"}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MouseGestureSettings({
  settings,
  zh,
  onChange,
}: {
  settings: Record<string, unknown>;
  zh: boolean;
  onChange: <Key extends keyof typeof readerGestureKeys>(
    key: Key,
    value: ReaderSettings[Key],
  ) => void;
}) {
  const booleanValue = (key: keyof typeof readerGestureKeys, fallback = true) =>
    typeof settings[readerGestureKeys[key]] === "boolean"
      ? settings[readerGestureKeys[key]] === true
      : fallback;
  const interval = [250, 350, 500].includes(Number(settings[readerGestureKeys.doubleClickInterval]))
    ? (Number(settings[readerGestureKeys.doubleClickInterval]) as 250 | 350 | 500)
    : 350;
  const toggles: Array<{
    key: Exclude<keyof typeof readerGestureKeys, "doubleClickInterval">;
    title: string;
    description: string;
  }> = [
    {
      key: "sideClickPaging",
      title: zh ? "左右区域翻页" : "Side-zone page turns",
      description: zh
        ? "单页和双页模式；左右 30% 区域立即翻页。"
        : "Single/double mode; the outer 30% zones turn pages immediately.",
    },
    {
      key: "centerClickControls",
      title: zh ? "中央单击显示或隐藏控制" : "Center click toggles controls",
      description: zh
        ? "所有阅读模式。开启双击缩放时会等待所选判定时间。"
        : "All reader modes. Waits for the chosen interval when double-click zoom is enabled.",
    },
    {
      key: "doubleClickZoom",
      title: zh ? "双击缩放" : "Double-click zoom",
      description: zh
        ? "仅中央区域；左右翻页区不参与双击。"
        : "Center zone only; side page zones never participate.",
    },
    {
      key: "ctrlWheelZoom",
      title: zh ? "Ctrl/Cmd + 滚轮缩放" : "Ctrl/Cmd + wheel zoom",
      description: zh ? "所有阅读模式。" : "All reader modes.",
    },
    {
      key: "wheelPageTurn",
      title: zh ? "鼠标滚轮翻页" : "Wheel page turns",
      description: zh
        ? "仅单页和双页模式；连续滚动保持原生滚动。"
        : "Single/double mode only; continuous mode keeps native scrolling.",
    },
    {
      key: "dragPan",
      title: zh ? "拖动平移" : "Drag to pan",
      description: zh
        ? "分页模式且缩放超过 100% 时可用。"
        : "Available in paged modes above 100% zoom.",
    },
  ];
  return (
    <div id="setting-gestures" tabIndex={-1} className="mt-6">
      <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground/60">
        <MousePointer2 size={17} />
        {zh ? "鼠标与手势" : "Mouse & Gestures"}
      </h3>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {toggles.map((item) => {
          const enabled = booleanValue(item.key);
          return (
            <div
              key={item.key}
              className="flex items-start justify-between gap-3 border border-border bg-panel p-3"
            >
              <div>
                <div className="text-sm font-medium">{item.title}</div>
                <div className="mt-1 text-xs leading-5 text-foreground/50">{item.description}</div>
              </div>
              <button
                type="button"
                data-gesture-setting={item.key}
                className={`h-7 shrink-0 border px-2 text-xs ${enabled ? "border-accent bg-accent text-accentText" : "border-border bg-background text-foreground/60"}`}
                aria-pressed={enabled}
                onClick={() => onChange(item.key, !enabled)}
              >
                {enabled ? (zh ? "开启" : "On") : zh ? "关闭" : "Off"}
              </button>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border border-border bg-panel p-3">
        <div>
          <div className="text-sm font-medium">{zh ? "双击判定速度" : "Double-click timing"}</div>
          <div className="mt-1 text-xs text-foreground/50">
            {zh
              ? "只影响中央单击仲裁，不延迟左右翻页。"
              : "Only affects center-click arbitration; side page turns remain immediate."}
          </div>
        </div>
        <div className="flex" role="group" aria-label={zh ? "双击判定速度" : "Double-click timing"}>
          {([250, 350, 500] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={`h-8 border px-3 text-xs ${interval === value ? "border-accent bg-accent text-accentText" : "border-border bg-background text-foreground/65"}`}
              aria-pressed={interval === value}
              data-double-click-interval={value}
              onClick={() => onChange("doubleClickInterval", value)}
            >
              {value === 250
                ? zh
                  ? "短"
                  : "Short"
                : value === 350
                  ? zh
                    ? "标准"
                    : "Standard"
                  : zh
                    ? "长"
                    : "Long"}{" "}
              {value}ms
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function categoryText(category: ShortcutCategory, zh: boolean): string {
  const labels = zh
    ? { global: "全局", library: "漫画库", reader: "阅读器", display: "显示" }
    : { global: "Global", library: "Library", reader: "Reader", display: "Display" };
  return labels[category];
}

function shortcutErrorText(error: string, zh: boolean): string {
  if (error.includes("modifier-only"))
    return zh ? "不能只绑定修饰键。" : "Modifier-only bindings are not allowed.";
  if (error.includes("escape-reserved"))
    return zh ? "Esc 保留用于安全关闭和退出。" : "Esc is reserved for safe close and exit actions.";
  if (error.includes("system-reserved"))
    return zh
      ? "此组合由 Windows 或 WebView 保留。"
      : "This combination is reserved by Windows or WebView.";
  if (error.includes("shortcut-binding-required"))
    return zh ? "此操作必须保留至少一个快捷键。" : "This action must keep at least one binding.";
  if (error.includes("shortcut-conflict-locked"))
    return zh
      ? "此快捷键与固定安全操作冲突。"
      : "This shortcut conflicts with a fixed safety action.";
  return zh ? "无法保存此快捷键。" : "This shortcut could not be saved.";
}
