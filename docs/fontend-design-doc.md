# Dense Developer Dark — Frontend Design Spec

> **For:** Claude Code agents building ShadCN + Tailwind frontends
> **Source:** 4 reference app screenshots — Customize/Skills panel, Chat/agent view, Task execution view, Plugin detail view
> **Last updated:** 2026-04-01

---

## Design Principles

> These are the non-negotiable qualitative constraints. Read these first. They override category-level specifics when in conflict.

- **Surfaces are structural and docked — never floating.** The layout is three fixed side-by-side panes. Primary content never lives in floating cards. Cards appear only in grid-selection contexts (e.g. plugin skill cards).
- **This is a developer tool, not a product.** Remove all decorative elements. No gradients, illustrations, or marketing-style visual weight.
- **Density is the default.** When in doubt between two spacing options, use the smaller one. The UI assumes the user is comfortable with compact layouts.
- **Orange is reserved exclusively for code-like references.** Commands, file paths, variable names, and slash commands render in warm orange/coral (`--code`). Do not use it for UI chrome, headings, or status indicators.
- **Blue is the single interactive accent.** Use it only for: primary action buttons, active toggles, filled tab states, checked progress indicators, and inline links. Nothing else should be blue.
- **Agent tool activity is a log, not a feature.** Tool use disclosures are visually subordinate — small text, muted, collapsible. They should not compete with content for attention.
- **Borders define regions; shadows do not exist.** All surface layering is done through subtle background color steps and 1px borders. No drop shadows at any layer.

---

## Color Palette

### Base Tokens (`globals.css`)

```css
:root {
  --background: #0E0E0E;        /* Page/app background — near black, not pure black */
  --foreground: #EBEBEB;        /* Primary text */

  --card: #161616;              /* Middle pane surfaces, content areas */
  --card-foreground: #EBEBEB;

  --popover: #1C1C1C;           /* Dropdown/popover background */
  --popover-foreground: #EBEBEB;

  --primary: #4A8BF4;           /* Blue — interactive accent only */
  --primary-foreground: #FFFFFF;

  --secondary: #1A1A1A;
  --secondary-foreground: #EBEBEB;

  --muted: #1C1C1C;             /* Slightly elevated surface, e.g. skill cards, right panel sections */
  --muted-foreground: #888888;  /* Metadata labels, timestamps, tool disclosure text */

  /* shadcn system token — hover/focus surface for interactive elements (nav items,
     dropdown rows, command items). Set to the subtle hover background color. */
  --accent: #222222;
  --accent-foreground: #EBEBEB;

  --destructive: #E54545;
  --destructive-foreground: #FFFFFF;

  --border: #252525;            /* Very subtle — barely perceptible 1px borders between panes */
  --input: #2A2A2A;
  --ring: #4A8BF4;              /* Focus ring matches primary blue */

  /* Sidebar tokens */
  --sidebar-background: #111111;
  --sidebar-foreground: #EBEBEB;
  --sidebar-primary: #4A8BF4;
  --sidebar-primary-foreground: #FFFFFF;
  --sidebar-accent: #222222;
  --sidebar-accent-foreground: #EBEBEB;
  --sidebar-border: #252525;

  --radius: 0.375rem;           /* 6px — slightly rounded globally */

  /* Custom tokens */
  --code: #E8714A;              /* Warm orange — code-like references only (commands, paths, variables) */
  --code-foreground: #FFFFFF;
}
```

### Usage Notes

- `--code` (#E8714A orange) is a custom token for code-like references only. Apply it as `text-[--code]` on inline code strings, commands, file paths, and variable values. Never use it for buttons, status badges, or general emphasis.
- `--accent` (#222222) is the shadcn hover/focus surface token — used automatically by interactive components (nav items, dropdown rows, command palette). Do not use it directly for visible brand color.
- `--primary` (#4A8BF4 blue) is used sparingly — primary CTA buttons, active tab fills, toggle on-state, checked progress circles, and hyperlinks. If it appears more than once per view, reconsider.
- `--muted-foreground` is the default color for all metadata: timestamps, "Added by" labels, tool disclosure text, right-panel section content. Primary text (`--foreground`) is reserved for content the user is meant to read.
- Borders between panes use `--border` at full opacity. Within-pane dividers (e.g. between "Try asking" rows) use `--border` at lower opacity or as a hairline.
- `--card` (#161616) is the color of the middle content pane and list areas. `--muted` (#1C1C1C) is the slightly elevated layer above it — used for cards, right panel sections, and the detail content area.

---

## Typography

### Font Roles

**Font A — UI / sans-serif:**
Used for: navigation items, sidebar labels, metadata, plugin descriptions, UI chrome throughout, tool disclosure text, right-panel content, badges, section labels
Character: Clean geometric/variable sans-serif. Neutral and utilitarian. Regular and medium weights. Works at small sizes without losing clarity.
Open-source matches: *Roboto Flex, Inter, DM Sans*
Confirmed: **Roboto Flex**

**Font B — Content / serif:**
Used for: primary chatbot responses, main readable content, long-form text the user is meant to read
Character: Warm humanist serif. Editorial reading feel. Comfortable line height. Regular weight only in most uses.
Open-source matches: *Merriweather, Lora, Source Serif 4*
Confirmed: **Merriweather**

**Font C — Mono / code:**
Used for: inline commands, slash command strings, file paths, variable names and values — always rendered in `--code` orange
Character: Developer-style monospace. Moderate weight, good at 12–14px.
Open-source matches: *JetBrains Mono, Fira Code, Cascadia Code*
Confirmed: **Fira Code**

```css
/* globals.css */
--font-sans: 'Roboto Flex', sans-serif;
--font-serif: 'Merriweather', Georgia, serif;
--font-mono: 'Fira Code', monospace; 
```

### Scale & Usage

| Role | Size | Weight | Font | Usage |
|---|---|---|---|---|
| Page / task title | 17px | 500 | A (sans) | Task name in header, plugin name |
| Section header | 15px | 600 | A (sans) | In-content section titles (e.g. "Examples") |
| Body / response | 14–15px | 400 | B (serif) | Primary chat responses, long-form content |
| UI text | 13–14px | 400 | A (sans) | Nav items, list items, labels, UI chrome |
| Caption / Metadata | 11–12px | 400 | A (sans) | Timestamps, metadata labels, "Added by" |
| Code / Mono | 13px | 400 | C (mono) | Commands, paths, variable values — in `--code` |

### Typography Rules

- Font B (Merriweather serif) is used exclusively for content the user is meant to read — chatbot responses, long-form output. All UI chrome, navigation, labels, and metadata use Font A (Roboto Flex).
- Muted/thinking text (e.g. agent reasoning shown before a response) uses Font A in `--muted-foreground`, not Font B. The shift to Font B signals "this is the real response."
- Code/command strings use Font C at 13px in `text-[--code]` orange inside pill-shaped containers.
- Line height for Font B content: 1.6. For Font A UI text and compact lists: 1.35.
- No all-caps usage detected in screenshots.

---

## Spacing System

### Base Unit

**Base:** 4px (Tailwind default) — all spacing should be multiples of this.

### Component Internal Padding

| Component | Padding |
|---|---|
| Button (sm) | px-2 py-1 |
| Button (default) | px-3 py-1.5 |
| Input | px-3 py-1.5 |
| Sidebar nav item | px-3 py-1.5 |
| Middle pane list item | px-3 py-2 |
| Skill card | p-3 |
| Detail content area | px-5 py-5 |
| User message block | px-5 py-4 |
| Right panel section | px-3 py-3 |
| Metadata grid row | py-0 (label and value are inline, no vertical gap) |

### Density Note

Default to compact. If a spacing choice feels comfortable, reduce it by one Tailwind step. Whitespace is not a design feature here — it's wasted screen real estate.

---

## Border Radius

**Global radius token:** `--radius: 0.375rem` (6px)

| Context | Value | Notes |
|---|---|---|
| Panes / panels | 0px | Fixed regions have no radius — they extend to viewport edges |
| Skill/plugin cards | 6px | Slightly rounded, consistent with global radius |
| Buttons | 4–6px | Slightly rounded, not pill |
| Inputs | 6px | Match global radius |
| User message block | 8px | Slightly more rounded to distinguish from structural surfaces |
| Code/command pills | 9999px (full) | Pill-shaped — the only full-radius element in the UI |
| "Script" / type badges | 4px | Small, rectangular — not pill |
| Progress circles | 50% | Circular |
| Modals | 8px | If present |

Code command pills are the sole exception to the "slightly rounded" rule. Everything else uses 0–8px.

---

## Elevation & Surfaces

### Model

Flat/bordered with background color stepping. No drop shadows at any layer. Depth is communicated exclusively by:
1. Background color darkening/lightening by ~8–12 hex steps between layers
2. Subtle 1px `--border` lines between regions

### Layer Stack

| Layer | Background | Border | Shadow |
|---|---|---|---|
| App background | `--background` (#0E0E0E) | none | none |
| Left sidebar | `--background` (same or ~#111111) | `1px --border` right edge | none |
| Middle pane | `--card` (#161616) | `1px --border` right edge | none |
| Right panel | `--card` (#161616) | `1px --border` left edge | none |
| Right panel sections | `--muted` (#1C1C1C) | `1px --border` | none |
| Skill/plugin cards | `--muted` (#1C1C1C) | `1px --border` | none |
| Dropdown / popover | `--popover` (#1C1C1C) | `1px --border` | none |
| User message block | `--muted` (#1C1C1C) | none | none |
| Code command pill | ~#1E1E1E | none | none |

---

## Component Style

> Describe visual intent only. Do not specify ShadCN component names, variants, or props — those are for the implementor.
>
> All component patterns visible in the reference screenshots are in-scope, including app-specific ones (chat message blocks, tool disclosure rows, streaming indicators, etc.). The implementor maps these to appropriate components at build time.

### Buttons

- **Primary action:** Small, slightly rounded (6px), solid blue fill (`--primary`). Compact padding. Label only — no icons unless the button is icon-only. Example: the "Edit" button in the skill detail header.
- **Secondary action:** Outlined — 1px border, transparent background. Same small size as primary. Used for non-primary actions adjacent to a primary button.
- **Destructive action:** Not prominently visible in screenshots — infer red text-only or outlined red. Never filled red.
- **Icon-only buttons:** Ghost style — no border, no background until hover. Small (24–28px touch target). Used for "...", expand, mic, download icons.
- **Rules:**
  - One filled primary button per content region maximum.
  - Toolbar/header icon actions are ghost — not outlined.
  - The "Skills" tab button is the exception: filled blue pill, slightly larger, used as a primary filter/tab — it does not follow the standard button sizing.

### Inputs & Forms

- **Input style:** Outlined — 1px `--border`, subtle dark background (~`--input`). No filled background.
- **Input height:** Compact — ~32px
- **Label position:** Above field, small muted text
- **Placeholder style:** `--muted-foreground` color
- **Disabled state:** Reduced opacity (~50%)

### Select / Dropdown

- **Trigger style:** Looks like a small text label + chevron (e.g. "Sonnet 4.6 ↓" in reply bar) — not a full input-width field. Compact and inline.
- **Dropdown:** Matches surface language — dark background, 1px border, no shadow.

### Tables / Lists

- **List rows:** Compact ~32px height, left-padded icon + label. Hover state: subtle `--muted` background.
- **No data tables visible in screenshots** — if implementing, use compact row height (~32px), row-separator-only borders, no grid lines.
- **Alignment:** Left-aligned throughout.

### Badges & Tags

- **"Script" type badge:** Small rectangular (~4px radius), `--muted` background, `--muted-foreground` text, ~11px. Used to label tool call types.
- **Code command pill:** Full pill radius, `--code` orange text, slightly elevated dark background (~#1E1E1E). Used for slash command examples and inline command references.
- **Progress indicators:** Circular, filled blue (`--primary`) for complete, outlined/muted for incomplete or in-progress. Connected by thin horizontal lines.
- **Status badges:** Not prominently visible — if needed, use rectangular 4px-radius, muted tones.

### Navigation Items

- **Active state:** Slightly filled background (`--muted` or ~#222222), white/bright foreground text. No left-border accent. The fill is subtle — not a strong contrast highlight.
- **Inactive state:** Ghost — no background, `--muted-foreground` text.
- **Hover state:** Subtle `--muted` background fill, foreground shifts toward white.
- **Icon usage:** Always present for primary nav items. Icons are small (~16px), outline style, muted color until active.
- **Nested items:** Indented sub-items shown in Customize context tree (Skills, Connectors under plugin names). Same compact row style, slightly indented, no connecting lines.

### User Message Block

The user's input in task/chat views renders as a distinct content block — not a chat bubble. It is a full-width dark box (`--muted` background, 8px radius) with comfortable padding (~px-5 py-4). The text is large (~17–18px body size) and treated as the primary "task statement," not a conversational message. Visually distinct from agent output.

### Tool Use Disclosures

Small, inline, collapsible rows below agent content. Format: icon (clock for thinking, file for script) + description text + optional badge tag. All in `--muted-foreground` color. The text "Used [integration] >" or "Computer >" acts as a collapsible toggle. These must not visually compete with surrounding content — they are a log, not a feature.

---

## Iconography

- **Visual character:** Outline style, thin stroke (~1.5px). Clean and minimal. Not bold or filled.
- **Default size:** 16px for nav items and inline icons; 14px for tool disclosure icons
- **Usage density:** Moderate — present in nav items and tool disclosures, absent from content areas
- **Color:** Inherit `--muted-foreground` when inactive; inherit `--foreground` when active
- **Library:** Lucide React

---

## Motion

- **Presence:** Minimal. Do not add animations unless specified below.
- **Default transition:** `transition-colors duration-100 ease-out` for hover state color changes on nav items and list rows.
- **Collapsible sections:** Height animate on expand/collapse — `duration-150 ease-out`. No spring/bounce.
- **Page transitions:** None — pane content updates are instant.
- **Progress circles:** No animation — static state display only.
- **Do not add:** Fade-ins on content load, skeleton screens, entrance animations for list items. The UI renders immediately and statically.

---

## Implementation Handoff

The CSS token block in the Color Palette section above is the primary ShadCN-specific output of this doc. Use it as the starting point for the project's global CSS file.

**Note for Tailwind v4 projects:** The token block uses hex values for readability. Tailwind v4 with shadcn/ui requires OKLCH format in `@theme inline` blocks. Convert hex values to OKLCH before pasting into `globals.css`.

Component selection, variant choices, and className overrides are **not specified here** — use the component style descriptions above as visual intent, and consult the shadcn/ui docs or MCP server at implementation time to map them to the right components and props.

Resolve all `<!-- TODO: confirm -->` items below before beginning implementation.

---

## TODOs & Open Questions
