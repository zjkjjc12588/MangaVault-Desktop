import * as Dialog from "@radix-ui/react-dialog";
import { Search } from "lucide-react";
import { useState } from "react";
import { getUiLocale, t } from "../lib/i18n";
import type { AppRoute } from "../lib/navigation";
import {
  effectiveShortcutBindings,
  executeShortcutCommand,
  formatShortcutBinding,
  shortcutCommandText,
} from "../shortcuts/shortcutRegistry";
import { useShortcutHandler, useShortcutRegistrySnapshot } from "../shortcuts/useShortcut";

interface CommandPaletteProps {
  route: AppRoute;
}

export function CommandPalette({ route }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const registry = useShortcutRegistrySnapshot();

  useShortcutHandler("global.commandPalette", () => {
    setOpen((value) => !value);
    return true;
  });
  useShortcutHandler(
    "overlay.escape",
    () => {
      setOpen(false);
      return true;
    },
    open,
  );
  const locale = getUiLocale();
  const visibleCommands = registry.commands.filter((command) => {
    if (!command.paletteVisible) return false;
    if (command.scope !== "global" && command.scope !== route) return false;
    const text = shortcutCommandText(command.commandId, locale);
    return [
      text.name,
      text.description,
      ...effectiveShortcutBindings(command.commandId).map((binding) =>
        formatShortcutBinding(binding),
      ),
    ]
      .join(" ")
      .toLowerCase()
      .includes(query.trim().toLowerCase());
  });

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/55" />
        <Dialog.Content
          className="fixed left-1/2 top-24 z-50 w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-panel shadow-2xl"
          onEscapeKeyDown={(event) => event.preventDefault()}
        >
          <Dialog.Title className="sr-only">{t("quickActions")}</Dialog.Title>
          <div className="flex h-12 items-center gap-3 border-b border-border px-4">
            <Search size={18} className="text-foreground/55" />
            <input
              autoFocus
              className="h-full flex-1 bg-transparent text-sm outline-none"
              placeholder={t("typeAction")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="p-2">
            {visibleCommands.map((command) => (
              <button
                key={command.commandId}
                className="flex h-10 w-full items-center justify-between rounded-md px-3 text-left text-sm hover:bg-panelMuted"
                onClick={() => {
                  if (executeShortcutCommand(command.commandId)) setOpen(false);
                }}
              >
                <span>{shortcutCommandText(command.commandId, locale).name}</span>
                <span className="ml-3 text-xs text-foreground/45">
                  {effectiveShortcutBindings(command.commandId)
                    .map((binding) => formatShortcutBinding(binding))
                    .join(" / ")}
                </span>
              </button>
            ))}
            {visibleCommands.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-foreground/50">
                {t("noMatchingCommands")}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
