# Keyboard Shortcuts and Reader Gestures

MangaVault uses one application-wide shortcut registry and one capture-phase `keydown` listener.
Pages register command handlers with the registry; they do not install competing window listeners.

## Default bindings

| Scope   | Command               | Default bindings                  |
| ------- | --------------------- | --------------------------------- |
| Global  | Quick Actions         | `Ctrl/Cmd+K`                      |
| Reader  | Next page             | `ArrowRight`, `Space`, `PageDown` |
| Reader  | Previous page         | `ArrowLeft`, `PageUp`             |
| Reader  | Toggle bookmark       | `B`                               |
| Reader  | Focus Reading         | `F`                               |
| Reader  | Immersive reading     | `I`                               |
| Reader  | Show or hide controls | `H`                               |
| Reader  | Back to library       | `L`                               |
| Reader  | Page thumbnails       | `T`                               |
| Display | Fit width             | `W`                               |
| Display | Fit height            | `E`                               |

`Escape` is a fixed safety key. It closes the top overlay first, leaves immersive mode second,
and leaves system fullscreen third. Its safety behavior cannot be removed. Route commands remain
available in Quick Actions and have no browser-reserved default combinations.

## Binding normalization

- Navigation, function, `Escape`, `Space`, and `Enter` bindings use normalized
  `KeyboardEvent.key` values.
- Character bindings use the lower-case logical key, so letter case does not create duplicates.
- `KeyboardEvent.code` is retained for display, diagnostics, and numeric keypad distinction.
- `Ctrl` on Windows/Linux and `Cmd` on macOS are stored as the platform-neutral primary modifier.
- Modifier display order is fixed: primary, Ctrl, Alt/Option, Shift, Meta, then key.
- Numeric keypad keys retain `Numpad*` identities.
- IME composition and AltGraph input never execute commands.
- Repeated `keydown` events execute only commands that explicitly allow repetition.
- `preventDefault()` runs only after a matching active command successfully executes.

V1 supports one key or one modifier combination per binding and multiple bindings per command. It
does not support key sequences, macros, operating-system global shortcuts, or application-external
capture. Modifier-only, fixed `Escape`, and known Windows/WebView reserved combinations are rejected.

## Scope and conflicts

Active scopes resolve in this order: overlay, reader, library, global. A command executes once using
the highest-priority active match. Reader and library scopes are mutually exclusive, so they may
share a binding. Global and overlay bindings can overlap other active scopes and therefore produce a
conflict. Replacing a conflict requires explicit confirmation.

User bindings are stored in the existing `settings` table under `shortcuts.user_bindings`; no schema
migration is required. The settings page supports multiple bindings, individual removal, per-command
reset, full reset, conflict replacement, and immediate application.

## Reader pointer arbitration

Paged reading uses outer 30% page zones and a center 40% control zone. Side clicks turn pages on
pointer release without waiting for the double-click interval and never participate in zoom.
Center clicks wait only when double-click zoom is enabled. A second center click must use the same
primary button and pointer type, occur within 24 CSS pixels, and arrive within 250, 350, or 500 ms.

Interactive controls, overlays, IME input, text selection, control drags, image pan gestures, and
trackpad inertia block reader click actions. Continuous scroll disables side-zone paging. At zoom
levels above 100%, a drag beyond 8 CSS pixels becomes image panning and cannot become a click.
