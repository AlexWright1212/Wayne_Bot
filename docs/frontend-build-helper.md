# Frontend Build Helper

## Key File Paths

- App spec: `C:\Code\wayne_bot\spec\v1-spec.md`
- Frontend spec: `C:\Code\wayne_bot\spec\v1-frontend-spec.md`
- Frontend design doc: `C:\Code\wayne_bot\docs\frontend-design-doc.md`
- Frontend mock data: `C:\Code\wayne_bot\src\frontend\src\mocks`
- ShadCN Skill (global skill): invoke when required

---

## Build Progress

- [x] Layout shell
- [x] Sidebar
- [x] Top bar
- [x] Chat input + empty state
- [ ] Chat messages
- [ ] Visibility pane shell
- [ ] Visibility pane — simple tabs
- [ ] Visibility pane — complex tabs

### Handoff Notes (updated 2026-04-05)
- Visibility pane: fixed 400px width, CSS `transition-all` on width toggle. No `Resizable` component — spec didn't require drag-to-resize.
- `AlertDialogAction` is a plain Button with no auto-close behavior. Close is handled by clearing controlled `open` state. `AlertDialogCancel` does auto-close (wraps `Close` primitive).
- Badge muted styling: used `className="bg-muted text-muted-foreground"` override rather than a CVA variant. Consider adding a `muted` variant to `badge.tsx` if the pattern recurs.
- `SidebarContent` has built-in `overflow-auto no-scrollbar` — no need for `ScrollArea` wrapper inside the sidebar.
- `Select` in this project: `Select = SelectPrimitive.Root` directly, **no `items` prop** needed. Standard JSX composition. `alignItemWithTrigger={false}` on `SelectContent` for dropdown positioning.
- Base UI Select `onValueChange` receives `string | null` — always guard with `(v) => v && handler(v)` before passing to store setters.
- **Zustand stores** at `src/stores/`: `useConversationStore` (conversations, active ID, messages by conv ID, newChat/rename/delete/addUserMessage) and `useModelStore` (catalog, provider, modelId, reasoningLevel). AppSidebar and TopBar are wired to these stores; AppLayout reads from conversation store.
- **Empty state mock**: `MOCK_NEW_CHAT_ID` + a null-title conversation appended to `MOCK_CONVERSATIONS`. `MOCK_MESSAGES_BY_CONV` keyed by conversation ID — only the active conversation has messages. Selecting the "New Chat" entry shows `ChatEmpty`. Sending a message calls `addUserMessage` and transitions away from empty state.
- **`ChatInput`**: uses CSS `field-sizing-content` (already in Textarea base class) for auto-grow — no JS height logic needed. `min-h-[36px]`, `max-h-[200px]`, `overflow-y-auto`.
- `Textarea` component already has `field-sizing-content` in its base class — auto-grows without JS. Override `min-h-16` default with `min-h-[36px]` for compact chat input.

---

## Build Order

1. **Layout shell** — three-pane skeleton (sidebar, chat, visibility) with placeholder content and collapse/expand toggles. All other sections are built inside this container.
2. **Sidebar** — fills the left pane. No dependency on other sections; establishes conversation list + New Chat button early.
3. **Top bar** — fills the chat pane header. Comes before messages so the provider/model controls exist when we start testing the chat flow.
4. **Chat input + empty state** — bottom of the chat pane plus the "no messages" welcome view. Simpler than messages; establishes the input pattern before the complex message rendering.
5. **Chat messages** — user bubbles + assistant message blocks (thinking indicator, tool steps, summary indicator, markdown, footer metadata, inspect button). Most complex section; built last in the chat pane so the surrounding shell is already in place.
6. **Visibility pane shell** — tab bar (7 tabs) + persistent footer. Fills the right pane structurally before any tab content exists.
7. **Visibility pane — simple tabs** — Response Metadata, Token Counts, Reasoning Content, Summary Event, Config. All are data-display only; no complex custom rendering.
8. **Visibility pane — complex tabs** — Request Payload (collapsible JSON viewer with auto-collapse on long strings) and Tool Trace (timeline stepper with expandable step data). Saved for last because both require non-trivial custom components.

---

## Component Inventory

### Map (section → components)

| Section | Components |
|---|---|
| Layout shell | `sidebar`, `button`, `separator` |
| Sidebar | `sidebar`, `scroll-area`, `context-menu`, `dropdown-menu`, `alert-dialog`, `tooltip`, `badge`, `input` |
| Top bar | `select`, `separator`, `tooltip`, `badge`, `button`, `progress` |
| Chat input + empty state | `textarea`, `button`, `empty`, `tooltip` |
| Chat messages | `scroll-area`, `collapsible`, `badge`, `button`, `spinner`, `alert`, `skeleton`, `tooltip`, `separator` |
| Visibility pane shell | `tabs`, `scroll-area`, `separator` |
| Visibility simple tabs | `badge`, `collapsible`, `empty`, `skeleton`, `spinner`, `separator` |
| Visibility complex tabs | `collapsible`, `accordion`, `badge`, `spinner`, `scroll-area` |

### Install command

```bash
npx shadcn@latest add button badge separator scroll-area sidebar context-menu dropdown-menu alert-dialog tooltip select textarea input empty collapsible alert skeleton spinner tabs accordion progress --yes
```

Note: `sidebar` also installs `sheet` and `use-mobile` as dependencies.

### Key API findings

All components in this project use **Base UI** (`@base-ui/react`) primitives — not Radix — despite some registry metadata showing `radix-ui` as a dependency. Always verify by reading the installed `.tsx` file.

**Accordion** — Base UI API. No `type` prop. `defaultValue` is always an array. Use `multiple` boolean for multi-expand:
```tsx
<Accordion defaultValue={["step-1"]}>
  <AccordionItem value="step-1">...</AccordionItem>
</Accordion>
```

**Select** — Base UI API. No `items` prop needed. Standard JSX composition. Use `alignItemWithTrigger` on `SelectContent` (not `position`). Icons inside use `render` prop:
```tsx
<SelectContent alignItemWithTrigger={false} side="bottom">
  <SelectGroup>
    <SelectItem value="openai">OpenAI</SelectItem>
  </SelectGroup>
</SelectContent>
```

**Collapsible** — Base UI. `CollapsibleContent` is backed by `CollapsiblePrimitive.Panel`. No `asChild` — use `render` for custom triggers.

**Triggers generally** — use `render={<Button />}` not `asChild` throughout. For non-button renders, add `nativeButton={false}`:
```tsx
// correct
<DialogTrigger render={<Button />}>Open</DialogTrigger>

// correct (non-button)
<PopoverTrigger render={<span />} nativeButton={false}>...</PopoverTrigger>
```

**Sidebar** — wrap the entire app in `SidebarProvider`. Use `SidebarInset` for main content. `SidebarTrigger` handles collapse/expand state.

**TooltipProvider** — must wrap the app root (add to `main.tsx` or top-level layout).
