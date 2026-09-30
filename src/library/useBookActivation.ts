import {
  useCallback,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import type { Book } from "../lib/types";
import { t } from "../lib/i18n";
import { useLibraryStore } from "../stores/libraryStore";
import { useReaderStore } from "../stores/readerStore";
import {
  beginBookPointerGesture,
  getBookActivationState,
  getBookOpenMouseAction,
  isBookActionTarget,
  pointerIntentFromClick,
  runBookActivation,
  subscribeBookActivationPreferences,
  subscribeBookActivationState,
  updateBookPointerGesture,
  type PointerActivationSnapshot,
} from "./bookActivation";

export interface BookActivationBindings {
  "aria-label": string;
  "aria-selected": boolean;
  "data-book-activation": string;
  "data-book-selected": string;
  "data-book-opening": string;
  tabIndex: number;
  onClick: (event: MouseEvent<HTMLElement>) => void;
  onContextMenuCapture: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
}

export interface BookActivationApi {
  selectedBookId: number | null;
  openingBookId: number | null;
  activateBook: (book: Book) => void;
  bindingsFor: (book: Book, keyboardTarget?: boolean) => BookActivationBindings;
}

export function useBookActivation(
  onOpenReader: () => void,
  getInitialPage?: (book: Book) => number | undefined,
): BookActivationApi {
  const mode = useSyncExternalStore(
    subscribeBookActivationPreferences,
    getBookOpenMouseAction,
    getBookOpenMouseAction,
  );
  const activationState = useSyncExternalStore(
    subscribeBookActivationState,
    getBookActivationState,
    getBookActivationState,
  );
  const selectedBookId = useLibraryStore((state) => state.selectedBookId);
  const selectBook = useLibraryStore((state) => state.selectBook);
  const openBook = useReaderStore((state) => state.openBook);
  const pointerSnapshot = useRef<PointerActivationSnapshot | null>(null);

  const activateBook = useCallback(
    (book: Book) => {
      selectBook(book.id);
      void runBookActivation(book.id, async () => {
        onOpenReader();
        await openBook(book, getInitialPage?.(book));
      });
    },
    [getInitialPage, onOpenReader, openBook, selectBook],
  );

  const bindingsFor = useCallback(
    (book: Book, keyboardTarget = true): BookActivationBindings => ({
      "aria-label": `${book.title}, ${Math.round(book.progressPercent * 100)}% ${t("read")}`,
      "aria-selected": selectedBookId === book.id,
      "data-book-activation": String(book.id),
      "data-book-selected": selectedBookId === book.id ? "true" : "false",
      "data-book-opening": activationState.openingBookId === book.id ? "true" : "false",
      tabIndex: keyboardTarget ? 0 : -1,
      onPointerDown: (event) => {
        if (isBookActionTarget(event.target, event.currentTarget)) return;
        pointerSnapshot.current = beginBookPointerGesture(event);
      },
      onPointerMove: (event) => {
        pointerSnapshot.current = updateBookPointerGesture(pointerSnapshot.current, event);
      },
      onPointerCancel: () => {
        pointerSnapshot.current = null;
      },
      onClick: (event) => {
        const intent = pointerIntentFromClick(event, pointerSnapshot.current, mode);
        pointerSnapshot.current = null;
        if (intent === "select") selectBook(book.id);
        if (intent === "open") activateBook(book);
      },
      onContextMenuCapture: (event) => {
        if (!isBookActionTarget(event.target, event.currentTarget)) selectBook(book.id);
        pointerSnapshot.current = null;
      },
      onKeyDown: (event) => {
        if (isBookActionTarget(event.target, event.currentTarget)) return;
        if (event.key === "Enter") {
          event.preventDefault();
          activateBook(book);
          return;
        }
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          selectBook(book.id);
        }
      },
    }),
    [activateBook, activationState.openingBookId, mode, selectBook, selectedBookId],
  );

  return {
    selectedBookId,
    openingBookId: activationState.openingBookId,
    activateBook,
    bindingsFor,
  };
}
