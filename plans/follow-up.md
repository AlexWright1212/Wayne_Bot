# Follow-up

Out-of-scope bugs and items to address later.

---

- **Sidebar rename input closes immediately** — `ContextMenu` onSelect fires, input renders and auto-focuses, but the ContextMenu close returns focus elsewhere which triggers `onBlur` → `commitRename()` → input gone before user can type. Fix: use `onCloseAutoFocus` to prevent focus return, or switch to a dialog-based rename.

- **Sidebar delete confirmation dialog doesn't open** — `AlertDialog` triggered from `ContextMenu` onSelect doesn't open. Likely a Radix portal/focus conflict between ContextMenu and AlertDialog. Fix: investigate Radix ContextMenu + AlertDialog interaction; may need `asChild` or deferred state update via `setTimeout`.
