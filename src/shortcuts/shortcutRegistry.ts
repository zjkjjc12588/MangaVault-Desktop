export type ShortcutScope = "global" | "library" | "reader" | "overlay";
export type ShortcutCategory = "global" | "library" | "reader" | "display";
export type ShortcutInputPolicy = "allow" | "outside-input";
export type ShortcutPlatform = "mac" | "windows" | "linux";

export interface ShortcutBinding {
  normalizedKey: string;
  code: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  primary: boolean;
  platformDisplayLabel: string;
}

export interface ShortcutExecution {
  event: KeyboardEvent;
  binding: ShortcutBinding;
  commandId: string;
}

export type ShortcutHandler = (execution: ShortcutExecution) => boolean;

export interface ShortcutCommand {
  commandId: string;
  name: { "zh-CN": string; "en-US": string };
  category: ShortcutCategory;
  description: { "zh-CN": string; "en-US": string };
  defaultBindings: ShortcutBinding[];
  userBindings: ShortcutBinding[] | null;
  scope: ShortcutScope;
  allowEmpty: boolean;
  allowRepeat: boolean;
  preventDefault: boolean;
  inputPolicy: ShortcutInputPolicy;
  priority: number;
  customizable: boolean;
  paletteVisible: boolean;
  execute: (execution: ShortcutExecution) => boolean;
}

export interface ShortcutConflict {
  commandId: string;
  scope: ShortcutScope;
  binding: ShortcutBinding;
  replaceable: boolean;
}

export interface ShortcutRegistrySnapshot {
  revision: number;
  commands: ShortcutCommand[];
}

export const SHORTCUT_SETTINGS_KEY = "shortcuts.user_bindings";

const scopePriority: Record<ShortcutScope, number> = {
  global: 0,
  library: 1,
  reader: 2,
  overlay: 3,
};

const runtimeHandlers = new Map<string, Array<{ token: symbol; handler: ShortcutHandler }>>();
const listeners = new Set<() => void>();
let userBindings = new Map<string, ShortcutBinding[]>();
let revision = 0;
let captureHandler: ((event: KeyboardEvent) => boolean) | null = null;

function localized(zh: string, en: string) {
  return { "zh-CN": zh, "en-US": en } as const;
}

function defaultBinding(
  normalizedKey: string,
  code: string,
  modifiers: Partial<Pick<ShortcutBinding, "ctrl" | "alt" | "shift" | "meta" | "primary">> = {},
): ShortcutBinding {
  return withDisplayLabel({
    normalizedKey,
    code,
    ctrl: modifiers.ctrl ?? false,
    alt: modifiers.alt ?? false,
    shift: modifiers.shift ?? false,
    meta: modifiers.meta ?? false,
    primary: modifiers.primary ?? false,
    platformDisplayLabel: "",
  });
}

function command(definition: Omit<ShortcutCommand, "userBindings" | "execute">): ShortcutCommand {
  return {
    ...definition,
    userBindings: null,
    execute: (execution) => executeRuntimeHandler(definition.commandId, execution),
  };
}

const definitions: ShortcutCommand[] = [
  command({
    commandId: "global.commandPalette",
    name: localized("快速操作", "Quick Actions"),
    category: "global",
    description: localized(
      "打开可搜索的快速操作面板。",
      "Open the searchable quick actions palette.",
    ),
    defaultBindings: [defaultBinding("k", "KeyK", { primary: true })],
    scope: "global",
    allowEmpty: false,
    allowRepeat: false,
    preventDefault: true,
    inputPolicy: "allow",
    priority: 20,
    customizable: true,
    paletteVisible: false,
  }),
  command({
    commandId: "global.openLibrary",
    name: localized("打开漫画库", "Open Library"),
    category: "global",
    description: localized("切换到漫画库。", "Switch to the manga library."),
    defaultBindings: [],
    scope: "global",
    allowEmpty: true,
    allowRepeat: false,
    preventDefault: true,
    inputPolicy: "outside-input",
    priority: 10,
    customizable: true,
    paletteVisible: true,
  }),
  command({
    commandId: "global.openReader",
    name: localized("打开阅读器", "Open Reader"),
    category: "global",
    description: localized("切换到当前阅读器。", "Switch to the current reader."),
    defaultBindings: [],
    scope: "global",
    allowEmpty: true,
    allowRepeat: false,
    preventDefault: true,
    inputPolicy: "outside-input",
    priority: 10,
    customizable: true,
    paletteVisible: true,
  }),
  command({
    commandId: "global.openRecent",
    name: localized("打开最近阅读", "Open Recent"),
    category: "global",
    description: localized("切换到最近阅读。", "Switch to recent reading."),
    defaultBindings: [],
    scope: "global",
    allowEmpty: true,
    allowRepeat: false,
    preventDefault: true,
    inputPolicy: "outside-input",
    priority: 10,
    customizable: true,
    paletteVisible: true,
  }),
  command({
    commandId: "global.openSettings",
    name: localized("打开设置", "Open Settings"),
    category: "global",
    description: localized("切换到应用设置。", "Switch to application settings."),
    defaultBindings: [],
    scope: "global",
    allowEmpty: true,
    allowRepeat: false,
    preventDefault: true,
    inputPolicy: "outside-input",
    priority: 10,
    customizable: true,
    paletteVisible: true,
  }),
  command({
    commandId: "library.importFolder",
    name: localized("添加漫画文件夹", "Add Manga Folder"),
    category: "library",
    description: localized(
      "选择并扫描新的漫画根目录。",
      "Choose and scan a new manga root folder.",
    ),
    defaultBindings: [],
    scope: "library",
    allowEmpty: true,
    allowRepeat: false,
    preventDefault: true,
    inputPolicy: "outside-input",
    priority: 10,
    customizable: true,
    paletteVisible: true,
  }),
  command({
    commandId: "library.importFile",
    name: localized("导入漫画文件", "Import Manga File"),
    category: "library",
    description: localized(
      "选择一个或多个漫画归档文件。",
      "Choose one or more manga archive files.",
    ),
    defaultBindings: [],
    scope: "library",
    allowEmpty: true,
    allowRepeat: false,
    preventDefault: true,
    inputPolicy: "outside-input",
    priority: 10,
    customizable: true,
    paletteVisible: true,
  }),
  command({
    commandId: "reader.nextPage",
    name: localized("下一页", "Next Page"),
    category: "reader",
    description: localized(
      "向前阅读；方向键会遵循当前阅读方向。",
      "Read forward; arrow keys follow the reading direction.",
    ),
    defaultBindings: [
      defaultBinding("ArrowRight", "ArrowRight"),
      defaultBinding("Space", "Space"),
      defaultBinding("PageDown", "PageDown"),
    ],
    scope: "reader",
    allowEmpty: false,
    allowRepeat: true,
    preventDefault: true,
    inputPolicy: "outside-input",
    priority: 20,
    customizable: true,
    paletteVisible: true,
  }),
  command({
    commandId: "reader.previousPage",
    name: localized("上一页", "Previous Page"),
    category: "reader",
    description: localized(
      "向后阅读；方向键会遵循当前阅读方向。",
      "Read backward; arrow keys follow the reading direction.",
    ),
    defaultBindings: [defaultBinding("ArrowLeft", "ArrowLeft"), defaultBinding("PageUp", "PageUp")],
    scope: "reader",
    allowEmpty: false,
    allowRepeat: true,
    preventDefault: true,
    inputPolicy: "outside-input",
    priority: 20,
    customizable: true,
    paletteVisible: true,
  }),
  command({
    commandId: "reader.bookmark",
    name: localized("切换书签", "Toggle Bookmark"),
    category: "reader",
    description: localized(
      "添加或移除当前页书签。",
      "Add or remove a bookmark on the current page.",
    ),
    defaultBindings: [defaultBinding("b", "KeyB")],
    scope: "reader",
    allowEmpty: true,
    allowRepeat: false,
    preventDefault: true,
    inputPolicy: "outside-input",
    priority: 10,
    customizable: true,
    paletteVisible: true,
  }),
  command({
    commandId: "reader.fullscreen",
    name: localized("切换专注阅读", "Toggle Focus Reading"),
    category: "display",
    description: localized(
      "进入或退出系统全屏并自动隐藏控制的专注阅读。",
      "Enter or leave focus reading with system fullscreen and auto-hiding controls.",
    ),
    defaultBindings: [defaultBinding("f", "KeyF")],
    scope: "reader",
    allowEmpty: true,
    allowRepeat: false,
    preventDefault: true,
    inputPolicy: "outside-input",
    priority: 10,
    customizable: true,
    paletteVisible: true,
  }),
  command({
    commandId: "reader.immersive",
    name: localized("切换沉浸阅读", "Toggle Immersive Reading"),
    category: "display",
    description: localized(
      "进入或退出只显示漫画的沉浸模式。",
      "Enter or leave distraction-free immersive reading.",
    ),
    defaultBindings: [defaultBinding("i", "KeyI")],
    scope: "reader",
    allowEmpty: true,
    allowRepeat: false,
    preventDefault: true,
    inputPolicy: "outside-input",
    priority: 10,
    customizable: true,
    paletteVisible: true,
  }),
  command({
    commandId: "reader.toggleControls",
    name: localized("显示或隐藏控制", "Show or Hide Controls"),
    category: "display",
    description: localized(
      "在全屏或沉浸阅读时切换控制栏。",
      "Toggle controls during fullscreen or immersive reading.",
    ),
    defaultBindings: [defaultBinding("h", "KeyH")],
    scope: "reader",
    allowEmpty: true,
    allowRepeat: false,
    preventDefault: true,
    inputPolicy: "outside-input",
    priority: 10,
    customizable: true,
    paletteVisible: true,
  }),
  command({
    commandId: "reader.returnLibrary",
    name: localized("返回漫画库", "Back to Library"),
    category: "reader",
    description: localized(
      "关闭当前阅读视图并返回漫画库。",
      "Close the reader view and return to the library.",
    ),
    defaultBindings: [defaultBinding("l", "KeyL")],
    scope: "reader",
    allowEmpty: true,
    allowRepeat: false,
    preventDefault: true,
    inputPolicy: "outside-input",
    priority: 10,
    customizable: true,
    paletteVisible: true,
  }),
  command({
    commandId: "reader.thumbnails",
    name: localized("页面缩略图", "Page Thumbnails"),
    category: "reader",
    description: localized(
      "打开或关闭页面缩略图导航。",
      "Open or close page thumbnail navigation.",
    ),
    defaultBindings: [defaultBinding("t", "KeyT")],
    scope: "reader",
    allowEmpty: true,
    allowRepeat: false,
    preventDefault: true,
    inputPolicy: "outside-input",
    priority: 10,
    customizable: true,
    paletteVisible: true,
  }),
  command({
    commandId: "reader.fitWidth",
    name: localized("适应宽度", "Fit Width"),
    category: "display",
    description: localized("将漫画缩放为适应可用宽度。", "Fit the manga to the available width."),
    defaultBindings: [defaultBinding("w", "KeyW")],
    scope: "reader",
    allowEmpty: true,
    allowRepeat: false,
    preventDefault: true,
    inputPolicy: "outside-input",
    priority: 10,
    customizable: true,
    paletteVisible: true,
  }),
  command({
    commandId: "reader.fitHeight",
    name: localized("适应高度", "Fit Height"),
    category: "display",
    description: localized("将漫画缩放为适应可用高度。", "Fit the manga to the available height."),
    defaultBindings: [defaultBinding("e", "KeyE")],
    scope: "reader",
    allowEmpty: true,
    allowRepeat: false,
    preventDefault: true,
    inputPolicy: "outside-input",
    priority: 10,
    customizable: true,
    paletteVisible: true,
  }),
  command({
    commandId: "reader.zoomIn",
    name: localized("放大", "Zoom In"),
    category: "display",
    description: localized("放大漫画页面。", "Increase manga page zoom."),
    defaultBindings: [],
    scope: "reader",
    allowEmpty: true,
    allowRepeat: true,
    preventDefault: true,
    inputPolicy: "outside-input",
    priority: 10,
    customizable: true,
    paletteVisible: false,
  }),
  command({
    commandId: "reader.zoomOut",
    name: localized("缩小", "Zoom Out"),
    category: "display",
    description: localized("缩小漫画页面。", "Decrease manga page zoom."),
    defaultBindings: [],
    scope: "reader",
    allowEmpty: true,
    allowRepeat: true,
    preventDefault: true,
    inputPolicy: "outside-input",
    priority: 10,
    customizable: true,
    paletteVisible: false,
  }),
  command({
    commandId: "overlay.escape",
    name: localized("关闭最上层面板", "Close Top Overlay"),
    category: "global",
    description: localized(
      "固定安全键：关闭当前最上层面板。",
      "Fixed safety key: close the topmost overlay.",
    ),
    defaultBindings: [defaultBinding("Escape", "Escape")],
    scope: "overlay",
    allowEmpty: false,
    allowRepeat: false,
    preventDefault: true,
    inputPolicy: "allow",
    priority: 100,
    customizable: false,
    paletteVisible: false,
  }),
  command({
    commandId: "overlay.confirm",
    name: localized("确认当前提示", "Confirm Current Prompt"),
    category: "global",
    description: localized(
      "关闭阅读教学或全屏提示。",
      "Dismiss the reader tutorial or fullscreen hint.",
    ),
    defaultBindings: [defaultBinding("Enter", "Enter"), defaultBinding("Space", "Space")],
    scope: "overlay",
    allowEmpty: false,
    allowRepeat: false,
    preventDefault: true,
    inputPolicy: "allow",
    priority: 90,
    customizable: false,
    paletteVisible: false,
  }),
  command({
    commandId: "reader.escapePresentation",
    name: localized("安全退出阅读显示", "Safe Reader Exit"),
    category: "reader",
    description: localized(
      "固定安全键：依次退出沉浸阅读或系统全屏。",
      "Fixed safety key: leave immersive reading or system fullscreen.",
    ),
    defaultBindings: [defaultBinding("Escape", "Escape")],
    scope: "reader",
    allowEmpty: false,
    allowRepeat: false,
    preventDefault: true,
    inputPolicy: "allow",
    priority: 100,
    customizable: false,
    paletteVisible: false,
  }),
];

let snapshot = buildSnapshot();

export function getShortcutRegistrySnapshot(): ShortcutRegistrySnapshot {
  return snapshot;
}

export function subscribeShortcutRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function shortcutCommandText(
  commandId: string,
  locale: "zh-CN" | "en-US",
): { name: string; description: string } {
  const item = snapshot.commands.find((command) => command.commandId === commandId);
  return item
    ? { name: item.name[locale], description: item.description[locale] }
    : { name: commandId, description: commandId };
}

export function effectiveShortcutBindings(commandId: string): ShortcutBinding[] {
  const item = snapshot.commands.find((command) => command.commandId === commandId);
  return item ? (item.userBindings ?? item.defaultBindings).map(cloneBinding) : [];
}

export function registerShortcutHandler(commandId: string, handler: ShortcutHandler): () => void {
  if (!definitions.some((command) => command.commandId === commandId)) {
    throw new Error(`Unknown shortcut command: ${commandId}`);
  }
  const token = Symbol(commandId);
  const handlers = runtimeHandlers.get(commandId) ?? [];
  runtimeHandlers.set(commandId, [...handlers, { token, handler }]);
  return () => {
    const remaining = (runtimeHandlers.get(commandId) ?? []).filter((item) => item.token !== token);
    if (remaining.length) runtimeHandlers.set(commandId, remaining);
    else runtimeHandlers.delete(commandId);
  };
}

export function executeShortcutCommand(commandId: string): boolean {
  const item = definitions.find((command) => command.commandId === commandId);
  const binding = effectiveShortcutBindings(commandId)[0] ?? defaultBinding("", "");
  if (!item) return false;
  return item.execute({
    commandId,
    binding,
    event: new globalThis.KeyboardEvent("keydown", { key: binding.normalizedKey }),
  });
}

export function dispatchShortcutKeyboardEvent(event: KeyboardEvent): boolean {
  if (captureHandler) {
    const captured = captureHandler(event);
    if (captured) consumeKeyboardEvent(event, true);
    return captured;
  }
  if (event.isComposing || event.getModifierState?.("AltGraph")) return false;
  const binding = shortcutBindingFromEvent(event);
  if (!binding) return false;
  const editable = isEditableTarget(event.target);
  const candidate = definitions
    .filter((item) => runtimeHandlers.has(item.commandId))
    .filter((item) => !event.repeat || item.allowRepeat)
    .filter((item) => !editable || item.inputPolicy === "allow")
    .filter((item) =>
      effectiveShortcutBindings(item.commandId).some((value) => bindingsEqual(value, binding)),
    )
    .sort(
      (left, right) =>
        scopePriority[right.scope] - scopePriority[left.scope] || right.priority - left.priority,
    )[0];
  if (!candidate) return false;
  const executed = candidate.execute({ event, binding, commandId: candidate.commandId });
  if (!executed) return false;
  consumeKeyboardEvent(event, candidate.preventDefault);
  return true;
}

export function beginShortcutCapture(handler: (event: KeyboardEvent) => boolean): () => void {
  captureHandler = handler;
  return () => {
    if (captureHandler === handler) captureHandler = null;
  };
}

export function shortcutBindingFromEvent(event: KeyboardEvent): ShortcutBinding | null {
  const normalizedKey = normalizeShortcutKey(event.key, event.code);
  if (!normalizedKey || isModifierOnly(normalizedKey)) return null;
  const primary = isMacPlatform()
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
  return withDisplayLabel({
    normalizedKey,
    code: event.code || normalizedKey,
    ctrl: primary ? false : event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: primary ? false : event.metaKey,
    primary,
    platformDisplayLabel: "",
  });
}

export function validateShortcutBinding(binding: ShortcutBinding): string | null {
  if (!binding.normalizedKey || isModifierOnly(binding.normalizedKey)) return "modifier-only";
  if (binding.normalizedKey === "Escape") return "escape-reserved";
  const id = bindingIdentity(binding);
  if (
    id === "Alt+F4" ||
    id === "Alt+Tab" ||
    id === "Primary+Alt+Delete" ||
    id === "Primary+Shift+Escape" ||
    (!isMacPlatform() && binding.meta)
  ) {
    return "system-reserved";
  }
  return null;
}

export function findShortcutConflicts(
  commandId: string,
  binding: ShortcutBinding,
): ShortcutConflict[] {
  const target = definitions.find((item) => item.commandId === commandId);
  if (!target) return [];
  return snapshot.commands
    .filter((item) => item.commandId !== commandId && scopesCanOverlap(target.scope, item.scope))
    .filter((item) =>
      effectiveShortcutBindings(item.commandId).some((value) => bindingsEqual(value, binding)),
    )
    .map((item) => ({
      commandId: item.commandId,
      scope: item.scope,
      binding: cloneBinding(binding),
      replaceable: item.customizable,
    }));
}

export function addShortcutBinding(
  commandId: string,
  binding: ShortcutBinding,
  replaceConflicts = false,
): void {
  const target = definitions.find((item) => item.commandId === commandId);
  if (!target?.customizable) throw new Error("shortcut-command-locked");
  const error = validateShortcutBinding(binding);
  if (error) throw new Error(error);
  const conflicts = findShortcutConflicts(commandId, binding);
  if (conflicts.length && !replaceConflicts) throw new Error("shortcut-conflict");
  if (conflicts.some((conflict) => !conflict.replaceable)) {
    throw new Error("shortcut-conflict-locked");
  }
  if (replaceConflicts) {
    for (const conflict of conflicts) {
      setEffectiveBindings(
        conflict.commandId,
        effectiveShortcutBindings(conflict.commandId).filter(
          (item) => !bindingsEqual(item, binding),
        ),
        false,
      );
    }
  }
  const current = effectiveShortcutBindings(commandId);
  if (!current.some((item) => bindingsEqual(item, binding)))
    current.push(withDisplayLabel(binding));
  setEffectiveBindings(commandId, current, false);
  publish();
}

export function removeShortcutBinding(commandId: string, binding: ShortcutBinding): void {
  const target = definitions.find((item) => item.commandId === commandId);
  if (!target?.customizable) throw new Error("shortcut-command-locked");
  const next = effectiveShortcutBindings(commandId).filter((item) => !bindingsEqual(item, binding));
  if (!next.length && !target.allowEmpty) throw new Error("shortcut-binding-required");
  setEffectiveBindings(commandId, next, true);
}

export function resetShortcutCommand(commandId: string): void {
  userBindings.delete(commandId);
  publish();
}

export function resetAllShortcutCommands(): void {
  userBindings.clear();
  publish();
}

export function exportShortcutUserBindings(): Record<string, ShortcutBinding[]> {
  return Object.fromEntries(
    [...userBindings.entries()].map(([commandId, bindings]) => [
      commandId,
      bindings.map((binding) => withDisplayLabel(binding)),
    ]),
  );
}

export function syncShortcutBindings(value: unknown): void {
  const parsed = new Map<string, ShortcutBinding[]>();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [commandId, bindings] of Object.entries(value)) {
      const definition = definitions.find((item) => item.commandId === commandId);
      if (!definition?.customizable || !Array.isArray(bindings)) continue;
      const normalized = bindings
        .map(normalizePersistedBinding)
        .filter((item): item is ShortcutBinding => Boolean(item))
        .filter((item) => validateShortcutBinding(item) === null)
        .filter(
          (binding) =>
            !definitions.some(
              (other) =>
                other.commandId !== commandId &&
                !other.customizable &&
                scopesCanOverlap(definition.scope, other.scope) &&
                other.defaultBindings.some((fixed) => bindingsEqual(fixed, binding)),
            ),
        );
      if (normalized.length || (definition.allowEmpty && bindings.length === 0))
        parsed.set(commandId, uniqueBindings(normalized));
    }
  }
  userBindings = parsed;
  publish();
}

export function formatShortcutBinding(
  binding: ShortcutBinding,
  platform: ShortcutPlatform = currentPlatform(),
): string {
  return withDisplayLabel(binding, platform).platformDisplayLabel;
}

export function bindingsEqual(left: ShortcutBinding, right: ShortcutBinding): boolean {
  return bindingIdentity(left) === bindingIdentity(right);
}

export function scopesCanOverlap(left: ShortcutScope, right: ShortcutScope): boolean {
  if (left === right) return true;
  if (left === "global" || right === "global") return true;
  if (left === "overlay" || right === "overlay") return true;
  return false;
}

export function __resetShortcutRegistryForTests(): void {
  userBindings.clear();
  runtimeHandlers.clear();
  captureHandler = null;
  publish();
}

function executeRuntimeHandler(commandId: string, execution: ShortcutExecution): boolean {
  const handlers = runtimeHandlers.get(commandId);
  return handlers?.at(-1)?.handler(execution) ?? false;
}

function setEffectiveBindings(
  commandId: string,
  bindings: ShortcutBinding[],
  shouldPublish: boolean,
) {
  const target = definitions.find((item) => item.commandId === commandId);
  if (!target) throw new Error("shortcut-command-missing");
  if (!bindings.length && !target.allowEmpty) throw new Error("shortcut-binding-required");
  userBindings.set(commandId, uniqueBindings(bindings.map((binding) => withDisplayLabel(binding))));
  if (shouldPublish) publish();
}

function publish() {
  revision += 1;
  snapshot = buildSnapshot();
  listeners.forEach((listener) => listener());
}

function buildSnapshot(): ShortcutRegistrySnapshot {
  return {
    revision,
    commands: definitions.map((item) => ({
      ...item,
      defaultBindings: item.defaultBindings.map(cloneBinding),
      userBindings: userBindings.has(item.commandId)
        ? (userBindings.get(item.commandId) ?? []).map(cloneBinding)
        : null,
    })),
  };
}

function normalizePersistedBinding(value: unknown): ShortcutBinding | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<ShortcutBinding>;
  if (typeof item.normalizedKey !== "string" || !item.normalizedKey) return null;
  return withDisplayLabel({
    normalizedKey: normalizeShortcutKey(item.normalizedKey, item.code ?? ""),
    code: typeof item.code === "string" ? item.code : item.normalizedKey,
    ctrl: item.ctrl === true,
    alt: item.alt === true,
    shift: item.shift === true,
    meta: item.meta === true,
    primary: item.primary === true,
    platformDisplayLabel: "",
  });
}

function normalizeShortcutKey(key: string, code: string): string {
  if (code.startsWith("Numpad")) return code;
  if (key === " ") return "Space";
  if (key.length === 1) return key.toLowerCase();
  const aliases: Record<string, string> = {
    Esc: "Escape",
    Spacebar: "Space",
    Left: "ArrowLeft",
    Right: "ArrowRight",
    Up: "ArrowUp",
    Down: "ArrowDown",
  };
  return aliases[key] ?? key;
}

function bindingIdentity(binding: ShortcutBinding): string {
  return [
    binding.primary ? "Primary" : "",
    binding.ctrl ? "Ctrl" : "",
    binding.alt ? "Alt" : "",
    binding.shift ? "Shift" : "",
    binding.meta ? "Meta" : "",
    binding.normalizedKey,
  ]
    .filter(Boolean)
    .join("+");
}

function uniqueBindings(bindings: ShortcutBinding[]): ShortcutBinding[] {
  return bindings.filter(
    (binding, index, all) => all.findIndex((item) => bindingsEqual(item, binding)) === index,
  );
}

function withDisplayLabel(
  binding: ShortcutBinding,
  platform: ShortcutPlatform = currentPlatform(),
): ShortcutBinding {
  const parts: string[] = [];
  if (binding.primary) parts.push(platform === "mac" ? "Cmd" : "Ctrl");
  if (binding.ctrl) parts.push("Ctrl");
  if (binding.alt) parts.push(platform === "mac" ? "Option" : "Alt");
  if (binding.shift) parts.push("Shift");
  if (binding.meta) parts.push(platform === "mac" ? "Cmd" : "Meta");
  parts.push(displayKey(binding.normalizedKey));
  return { ...binding, platformDisplayLabel: parts.join("+") };
}

function displayKey(key: string): string {
  const labels: Record<string, string> = {
    Space: "Space",
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowUp: "↑",
    ArrowDown: "↓",
    PageDown: "Page Down",
    PageUp: "Page Up",
    Backspace: "Backspace",
    Escape: "Esc",
    NumpadAdd: "Num +",
    NumpadSubtract: "Num -",
  };
  if (labels[key]) return labels[key];
  if (key.startsWith("Numpad")) return `Num ${key.slice("Numpad".length)}`;
  return key.length === 1 ? key.toUpperCase() : key;
}

function cloneBinding(binding: ShortcutBinding): ShortcutBinding {
  return { ...binding };
}

function isModifierOnly(key: string): boolean {
  return ["Control", "Shift", "Alt", "Meta", "AltGraph"].includes(key);
}

function isEditableTarget(target: unknown): boolean {
  return (
    target instanceof globalThis.HTMLElement &&
    (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable)
  );
}

function consumeKeyboardEvent(event: KeyboardEvent, preventDefault: boolean) {
  if (preventDefault) event.preventDefault();
  event.stopImmediatePropagation();
}

function currentPlatform(): ShortcutPlatform {
  const platform = globalThis.navigator?.platform?.toLowerCase() ?? "";
  if (platform.includes("mac")) return "mac";
  if (platform.includes("linux")) return "linux";
  return "windows";
}

function isMacPlatform(): boolean {
  return currentPlatform() === "mac";
}
