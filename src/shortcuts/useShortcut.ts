import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  getShortcutRegistrySnapshot,
  registerShortcutHandler,
  subscribeShortcutRegistry,
  type ShortcutHandler,
} from "./shortcutRegistry";

export function useShortcutHandler(
  commandId: string,
  handler: ShortcutHandler,
  active = true,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!active) return;
    return registerShortcutHandler(commandId, (execution) => handlerRef.current(execution));
  }, [active, commandId]);
}

export function useShortcutRegistrySnapshot() {
  return useSyncExternalStore(
    subscribeShortcutRegistry,
    getShortcutRegistrySnapshot,
    getShortcutRegistrySnapshot,
  );
}
