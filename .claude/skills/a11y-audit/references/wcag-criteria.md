# WCAG 2.1 AA Criteria — URL Map and Plain-English Impact

**Use this file when:** writing the Summary's "WCAG 2.1 AA criteria affected" block, or annotating an issue's WCAG field in the Layer 2 table or Layer 3 finding.

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

### 2.1.4 Character Key Shortcuts

- URL: https://www.w3.org/WAI/WCAG21/Understanding/character-key-shortcuts
- Plain: Single-letter shortcuts fire unexpectedly when screen readers intercept the key — AT users cannot use the app.

### 2.4.1 Bypass Blocks

- URL: https://www.w3.org/WAI/WCAG21/Understanding/bypass-blocks
- Plain: No skip link or landmark structure to bypass repeated content — keyboard users Tab through dozens of nav items every page.

### 2.4.2 Page Titled

- URL: https://www.w3.org/WAI/WCAG21/Understanding/page-titled
- Plain: The page title doesn't describe its purpose — screen-reader users can't tell where they are.

### 2.4.3 Focus Order

- URL: https://www.w3.org/WAI/WCAG21/Understanding/focus-order
- Plain: Tab moves focus in an order that doesn't match the visual layout — users lose track of where focus went.

### 2.4.4 Link Purpose (In Context)

- URL: https://www.w3.org/WAI/WCAG21/Understanding/link-purpose-in-context
- Plain: Links say "click here" or "more" without context — screen-reader users reading links list cannot tell where any link leads.

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

### 4.1.3 Status Messages

- URL: https://www.w3.org/WAI/WCAG21/Understanding/status-messages
- Plain: Dynamic status updates (toast, inline save confirmation, loading state) aren't announced to AT — screen-reader users miss state changes.

---

## Common calibration mistakes

- **Missing alt on decorative icon** — not a P0. Use `alt=""` and move on. Usually P2 or P3.
- **`outline: none` on focus** — P1/P2, not P0, IF there's any alternative indicator (`:focus-within` border, background change). P0 only if there's NO visible focus indicator at all.
- **Heading hierarchy wrong order** — degrades navigation but rarely blocks a workflow. Usually P2.
- **Missing `lang` attribute** — P2 unless the page contains mixed languages.
- **Duplicate IDs** — P2 unless the duplicates are on elements that AT references (form labels, `aria-labelledby` / `aria-describedby` targets), in which case P0/P1.

---

## Criteria the audit cannot verify from code alone

Flag these as candidates for "Items Requiring Runtime Tooling to Confirm," NOT as confirmed issues:

- **1.4.3, 1.4.11** — contrast ratios (depend on rendered colors; theme variables can't be computed statically)
- **1.4.4, 1.4.10** — resize and reflow (depend on layout at runtime)
- **2.4.7** — focus visibility (depends on rendered styles)
- **1.4.13** — hover/focus content behavior (depends on event timing)

Never claim pass or fail on these from static analysis alone. Per Rule 7, never predict what axe-core or Lighthouse will say about them.
