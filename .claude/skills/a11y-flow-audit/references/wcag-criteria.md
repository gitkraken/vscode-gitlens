# WCAG 2.1 AA Criteria — URL Map and Plain-English Impact

**Use this file when:** writing the Summary's "WCAG 2.1 AA criteria affected" block, or annotating a flow finding's WCAG field in the Layer 2 table or Layer 3 finding.

**Format rule:** every WCAG citation in the report MUST be a Markdown link to w3.org. The criterion number alone is not enough — a developer who doesn't know the spec should be one click away from it.

---

## Criteria commonly seen in audits

Each criterion below includes:

- The Understanding URL (use for Markdown links)
- A one-sentence plain-English description of what a real user experiences when the criterion fails

### 1.1.1 Non-text Content

- URL: https://www.w3.org/WAI/WCAG21/Understanding/non-text-content
- Plain: Images, icons, and non-text visuals have no text alternative — screen-reader users hear nothing or hear a file path instead of a description.

### 1.3.1 Info and Relationships

- URL: https://www.w3.org/WAI/WCAG21/Understanding/info-and-relationships
- Plain: Visual structure (lists, headings, groups, tables) isn't conveyed in the code — screen readers announce a flat stream instead of organized content.
- **Flow-specific impact:** landmark structure is how screen-reader users get an overview of a page. Missing `<main>`, unlabeled duplicate `<nav>`s, and `role="region"` without a name all collapse the page into an unorganized stream. Heading hierarchy is the other half of this criterion at the flow level — `<h1>` followed by `<h3>` (skipping `<h2>`) tells AT the structure is broken.

### 1.3.2 Meaningful Sequence

- URL: https://www.w3.org/WAI/WCAG21/Understanding/meaningful-sequence
- Plain: Content's reading order in the DOM doesn't match the visual order — screen-reader and keyboard users encounter content in a confusing sequence.

### 1.4.1 Use of Color

- URL: https://www.w3.org/WAI/WCAG21/Understanding/use-of-color
- Plain: Information is communicated with color alone (red = error, green = success) — color-blind users miss the information.

### 1.4.3 Contrast (Minimum)

- URL: https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum
- Plain: Text contrast against its background is below 4.5:1 — low-vision users cannot read it.

### 1.4.4 Resize Text

- URL: https://www.w3.org/WAI/WCAG21/Understanding/resize-text
- Plain: Text can't be zoomed to 200% without loss of content — low-vision users who enlarge text lose functionality.

### 1.4.10 Reflow

- URL: https://www.w3.org/WAI/WCAG21/Understanding/reflow
- Plain: The UI doesn't reflow at 320px width — mobile or zoomed users have to scroll horizontally to read.

### 1.4.11 Non-text Contrast

- URL: https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast
- Plain: UI components (borders, icons, focus indicators) lack 3:1 contrast — low-vision users cannot see interactive boundaries.

### 1.4.13 Content on Hover or Focus

- URL: https://www.w3.org/WAI/WCAG21/Understanding/content-on-hover-or-focus
- Plain: Tooltips or popovers disappear when the user moves to read them, or can't be dismissed with Escape — users with tremors or screen magnifiers lose the content.

### 2.1.1 Keyboard

- URL: https://www.w3.org/WAI/WCAG21/Understanding/keyboard
- Plain: Something that works with a mouse can't be operated with a keyboard — users who don't use pointing devices are blocked.

### 2.1.2 No Keyboard Trap

- URL: https://www.w3.org/WAI/WCAG21/Understanding/no-keyboard-trap
- Plain: Keyboard focus gets stuck inside a component and can't be tabbed out — user is stranded.
- **Flow-specific impact:** the classic flow-level keyboard trap is a modal whose focus trap is implemented partially — focus is pulled in on open but cannot be pushed back out because Escape isn't handled and Tab wraps forever. At the flow level, also check for traps created by composing a focus-trap component inside another focus-trap component (two traps fighting for the same focus).

### 2.1.4 Character Key Shortcuts

- URL: https://www.w3.org/WAI/WCAG21/Understanding/character-key-shortcuts
- Plain: Single-letter shortcuts fire unexpectedly when screen readers intercept the key — AT users cannot use the app.

### 2.4.1 Bypass Blocks

- URL: https://www.w3.org/WAI/WCAG21/Understanding/bypass-blocks
- Plain: No skip link or landmark structure to bypass repeated content — keyboard users Tab through dozens of nav items every page.
- **Flow-specific impact:** the most common flow-level failure. When a view has more than one landmark (`<header>` + `<nav>` + `<main>` + `<aside>`), keyboard-only users need a skip link pointing to `<main>` OR a proper landmark structure that AT can jump between. A view with several landmarks but no skip link, where the first landmark is a long navigation, blocks keyboard users from reaching primary content quickly every single time they load the page.

### 2.4.2 Page Titled

- URL: https://www.w3.org/WAI/WCAG21/Understanding/page-titled
- Plain: The page title doesn't describe its purpose — screen-reader users can't tell where they are.
- **Flow-specific impact:** at the flow level, the "page title" is what identifies the view to the user after landing. A title of "Home" or the site name alone on every route is ambiguous; each view needs a distinct, descriptive title.
- **VS Code webview calibration (and other embedded surfaces):** VS Code webviews do NOT own a traditional `<title>` in the user-visible sense — the containing panel/tab title is set by the extension host (e.g., `panel.title = 'GitLens Home'`), and the webview's `<title>` inside its HTML is not surfaced to the user. A spec-literal "add a `<title>` element" finding on a VS Code webview is correct-but-useless. The flow-audit equivalent is: the webview's root landmark (typically `<main>`) MUST expose the view's identity via an accessible name — `aria-label="GitLens Home"` or `aria-labelledby` pointing at a visible `<h1>`. Similar calibration applies to IDE tool panels, desktop app embedded panes, and any surface where the containing chrome owns the title: audit the root landmark's accessible name, not the HTML `<title>`.

### 2.4.3 Focus Order

- URL: https://www.w3.org/WAI/WCAG21/Understanding/focus-order
- Plain: Tab moves focus in an order that doesn't match the visual layout — users lose track of where focus went.
- **Flow-specific impact:** when components compose, DOM order may not match visual order — CSS `order`, `flex-direction: row-reverse`, `grid` placement, or a component rendered in a portal can all produce visually-adjacent elements that are DOM-distant. Flow audit checks that the Tab sequence across components matches what a sighted user would expect based on reading direction and layout.

### 2.4.4 Link Purpose (In Context)

- URL: https://www.w3.org/WAI/WCAG21/Understanding/link-purpose-in-context
- Plain: Links say "click here" or "more" without context — screen-reader users reading links list cannot tell where any link leads.

### 2.4.6 Headings and Labels

- URL: https://www.w3.org/WAI/WCAG21/Understanding/headings-and-labels
- Plain: Headings and labels don't describe the content or function they introduce — users cannot scan the page by heading or know what a field expects.
- **Flow-specific impact:** at the flow level, this surfaces as duplicate `<h2>` texts across sibling sections ("Details", "Details", "Details" where each applies to a different entity), or as headings that describe visual chunks rather than content. Screen-reader users use a heading list to navigate; ambiguous headings break that. Also applies to landmark labels — two `<nav>`s both labeled "Navigation" are indistinguishable.

### 2.4.7 Focus Visible

- URL: https://www.w3.org/WAI/WCAG21/Understanding/focus-visible
- Plain: No visible indicator when an element receives focus — keyboard users can't see where they are.

### 2.5.3 Label in Name

- URL: https://www.w3.org/WAI/WCAG21/Understanding/label-in-name
- Plain: The visible label on a control doesn't match its accessible name — speech-input users saying the visible word can't activate the control.

### 3.1.1 Language of Page

- URL: https://www.w3.org/WAI/WCAG21/Understanding/language-of-page
- Plain: No `lang` attribute on the root — screen readers use the wrong pronunciation dictionary.

### 3.2.1 On Focus

- URL: https://www.w3.org/WAI/WCAG21/Understanding/on-focus
- Plain: Focusing an element triggers a context change (navigation, popup) — users get surprised and disoriented.

### 3.2.2 On Input

- URL: https://www.w3.org/WAI/WCAG21/Understanding/on-input
- Plain: Changing a form value auto-submits or navigates — users lose their in-progress work.

### 3.2.3 Consistent Navigation

- URL: https://www.w3.org/WAI/WCAG21/Understanding/consistent-navigation
- Plain: Repeated navigation elements appear in a different order on different pages — users learning a pattern on one page find it broken on the next.
- **Flow-specific impact:** when a layout/shell is reused across routes but the nav order changes route-to-route, screen-reader and keyboard users who learned "Tab, Tab, Tab gets me to Settings" on one page discover the same keystrokes go somewhere else on the next. Flow audit checks for layout consistency across routes that share a shell.

### 3.2.4 Consistent Identification

- URL: https://www.w3.org/WAI/WCAG21/Understanding/consistent-identification
- Plain: The same component is labeled differently in different places — users can't tell it's the same thing.
- **Flow-specific impact:** if a search input is labeled "Search" on one page and "Find" on another, or if the same close-button has `aria-label="Close"` in one modal and `aria-label="Dismiss"` in another, users rely on inconsistent vocabulary. Flow audit checks label consistency across repeated components within a view.

### 3.3.1 Error Identification

- URL: https://www.w3.org/WAI/WCAG21/Understanding/error-identification
- Plain: Form errors aren't programmatically identified — screen-reader users don't know what went wrong.

### 3.3.2 Labels or Instructions

- URL: https://www.w3.org/WAI/WCAG21/Understanding/labels-or-instructions
- Plain: Form fields have placeholders but no associated label — screen-reader users hear nothing about what each field wants.

### 4.1.1 Parsing

- URL: https://www.w3.org/WAI/WCAG21/Understanding/parsing
- Plain: Invalid HTML (duplicate IDs, mismatched tags) — some AT fails silently in unpredictable ways.

### 4.1.2 Name, Role, Value

- URL: https://www.w3.org/WAI/WCAG21/Understanding/name-role-value
- Plain: Custom interactive components don't expose their name/role/state to AT — screen-reader users hear "clickable" with no information.
- **Flow-specific impact:** at the flow level, this surfaces as landmarks or composite components missing accessible names. A `role="region"` with no `aria-label` / `aria-labelledby` has no name — AT users hear "region" with no identity. Repeated landmarks (two `<nav>`s, two `<aside>`s) where only one has a name also trip this criterion.

### 4.1.3 Status Messages

- URL: https://www.w3.org/WAI/WCAG21/Understanding/status-messages
- Plain: Dynamic status updates (toast, inline save confirmation, loading state) aren't announced to AT — screen-reader users miss state changes.
- **Flow-specific impact:** the flow-level version of this criterion is the live-region conflict. Two components on the same page each owning their own `aria-live="polite"` region, firing concurrent announcements, produces either a race (one overwrites the other) or a jumble (AT reads both in undefined order). Flow audit enforces "single owner per announcement type" — one polite region, one assertive region, scoped to who speaks.

---

## Common calibration mistakes

- **Missing alt on decorative icon** — not a P0. Use `alt=""` and move on. Usually P2 or P3.
- **`outline: none` on focus** — P1/P2, not P0, IF there's any alternative indicator (`:focus-within` border, background change). P0 only if there's NO visible focus indicator at all.
- **Heading hierarchy wrong order** — degrades navigation but rarely blocks a workflow. Usually P2. Escalates to P1 when the view relies on heading navigation as its primary AT strategy (long-form content, documentation).
- **Missing `lang` attribute** — P2 unless the page contains mixed languages.
- **Duplicate IDs** — P2 unless the duplicates are on elements that AT references (form labels, `aria-labelledby` / `aria-describedby` targets), in which case P0/P1.
- **Missing skip link on single-landmark page** — not a finding. Skip links are required when there is more than one landmark to skip over.
- **Single `<main>` missing but one logical main region present** — usually P1 (not P0) — users can still navigate, but without the `<main>` landmark they lose the fastest-path jump-to-content shortcut.

---

## Criteria the audit cannot verify from code alone

Flag these as candidates for "Items Requiring Runtime Tooling to Confirm," NOT as confirmed issues:

- **1.4.3, 1.4.11** — contrast ratios (depend on rendered colors; theme variables can't be computed statically)
- **1.4.4, 1.4.10** — resize and reflow (depend on layout at runtime)
- **2.4.7** — focus visibility (depends on rendered styles)
- **1.4.13** — hover/focus content behavior (depends on event timing)
- **2.4.3 Focus Order (partial)** — the full tab sequence across components can be inferred from DOM ordering IF no `tabindex` positive values exist and no portals/teleports are in play. When those are present, the actual runtime tab sequence requires a browser. Flag as runtime-tooling when uncertain.
- **4.1.3 Status Messages (runtime timing of announcements)** — code analysis can verify that a live region exists and is scoped, but not that a specific runtime announcement actually fires. Announcement timing and cadence need a screen-reader pass.

Never claim pass or fail on these from static analysis alone. Per Rule 7, never predict what axe-core or Lighthouse will say about them.
