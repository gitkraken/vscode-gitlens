# Landmarks — Roles, Labels, and Composition Rules

**Why this file exists:** Landmarks are AT's table of contents for a view. Screen-reader users press `D` (NVDA), `VO+U` (VoiceOver), or the equivalent rotor to jump between landmarks. If landmarks are missing, misidentified, or duplicated without labels, the ToC collapses into noise and the jump shortcuts become unusable.

Flow audits enforce landmark hygiene. Component audits don't see enough of the view to make these calls — a single component cannot know whether it should render `<main>` because it doesn't know what else is in the view.

---

## Landmark roles and their HTML elements

| Role            | HTML element                                                                         | Purpose                     | Notes                                                                          |
| --------------- | ------------------------------------------------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------ |
| `banner`        | `<header>` (when not nested in section/article)                                      | Site-wide header            | One per view. Nested `<header>`s inside `<section>` / `<article>` don't count. |
| `navigation`    | `<nav>`                                                                              | A set of navigation links   | Multiple allowed if each is labeled.                                           |
| `main`          | `<main>`                                                                             | Primary content of the page | Exactly one per view.                                                          |
| `contentinfo`   | `<footer>` (when not nested)                                                         | Site-wide footer            | One per view.                                                                  |
| `complementary` | `<aside>`                                                                            | Supporting content          | Multiple allowed if each is labeled.                                           |
| `region`        | `<section>` with `aria-label` / `aria-labelledby`, OR `role="region"` on any element | Generic grouped region      | MUST have an accessible name, otherwise it's not a landmark at all.            |
| `search`        | `role="search"` on a form or region                                                  | Site search                 | `<form role="search">` is the idiomatic form.                                  |
| `form`          | `<form>` with accessible name                                                        | A form of significance      | Only becomes a landmark when named.                                            |

### The HTML-element shortcut

Prefer the HTML element over the `role`. `<nav>` is equivalent to `<div role="navigation">`, but shorter, more readable, and inherits browser defaults. Use `role="..."` only when the element semantics are already claimed (e.g., you can't change a `<ul>` to `<nav>` without restructuring — set `role="navigation"` on the `<ul>` instead).

---

## Labeling rules

### When `aria-label` is required

- **Any repeated landmark of the same role.** Two `<nav>`s, two `<aside>`s, two `role="region"`s — each MUST be uniquely labeled.
- **Every `role="region"` and every `<section>` acting as a region.** Without a name, `role="region"` is NOT a landmark — AT ignores it.
- **Every `role="search"`** — use `aria-label="Site search"` or `"Product search"` etc. to distinguish purpose.

### When `aria-label` is optional

- **Singleton landmarks with obvious purpose** — a single `<main>`, a single `<footer>` don't need labels. The role IS the identity.
- **`<nav>` when there's exactly one and its purpose is obvious from context** — most single-nav sites don't need a label. AT announces "navigation" and that's enough.

### Preferred: `aria-labelledby` over `aria-label`

If there's already a visible heading at the top of a region (`<h2>Sidebar</h2>`), use `aria-labelledby="sidebar-heading"` pointing at that heading's `id`. This way the AT label matches the visible text — no drift, no duplication.

```html
<aside aria-labelledby="sidebar-heading">
	<h2 id="sidebar-heading">Related articles</h2>
	...
</aside>
```

### Label uniqueness within role

Labels must be unique WITHIN a role but can collide ACROSS roles. Two `<nav>`s both called "Primary navigation" is a failure. One `<nav aria-label="Primary">` and one `<aside aria-label="Primary">` is fine — they have different roles.

---

## Handling multiple landmarks of the same type

**Two `<nav>`s:**

- Top-bar nav: `<nav aria-label="Primary">` or `<nav aria-label="Main">`
- Sidebar nav: `<nav aria-label="Sections">` or `<nav aria-label="Documentation">`
- Pagination nav (end of article): `<nav aria-label="Pagination">`
- Breadcrumb nav: `<nav aria-label="Breadcrumb">`

**Two `<aside>`s:**

- Each needs a label describing what it contains, not just "Sidebar".
- Good: `aria-label="Related articles"`, `aria-label="Filters"`.
- Bad: both labeled `"Sidebar"` (indistinguishable).

**Two `<header>`s / `<footer>`s:**

- Only the top-level `<header>` / `<footer>` is a landmark (banner/contentinfo).
- Nested `<header>` / `<footer>` inside `<section>` / `<article>` are NOT landmarks — they're just section headers/footers. No `aria-label` required.

---

## Common mistakes

### Multiple `<main>`s

A view with two `<main>`s is a spec violation. Common causes:

- App shell renders `<main>`, inner page also renders `<main>` inside it.
- Component library exports a `<Layout>` that wraps content in `<main>`, consumer uses it inside another `<main>`.

**Fix:** one `<main>`, at the outermost appropriate level. Inner "mains" become `role="region"` with labels, or `<section aria-labelledby="...">`.

### Unlabeled duplicate `<nav>`s

A view with a top nav and a sidebar nav, both unlabeled. AT users hear "navigation, navigation" from the rotor and can't tell which to jump to.

**Fix:** label both. See above.

### `role="region"` without accessible name

`<div role="region">...</div>` with no `aria-label` / `aria-labelledby`. AT spec says a `region` without a name is NOT a landmark — AT silently downgrades it. Worse: developer thinks they added a landmark; they didn't.

**Fix:** either add a label, or drop the role. If there's no natural label, the region probably shouldn't be a landmark.

### `<header>` / `<footer>` that are actually section headers

A `<header>` inside `<article>` or `<section>` is NOT a `banner` landmark. Some developers assume it IS and try to label it. It doesn't need a label — it's not a landmark.

**Fix:** leave it alone. Only the top-level `<header>` is the banner.

### Missing `<main>` entirely

A view with `<header>`, `<nav>`, and body content — but no `<main>` wrapping the primary content. AT users lose the "jump to main content" shortcut. This is one of the most common flow-level failures.

**Fix:** wrap the primary content in `<main>`. Exactly one per view. Add `tabindex="-1"` and a sensible `id` if skip links target it.

### Using `<section>` as a generic grouper instead of `<div>`

`<section>` without a label is also not a landmark, but worse: some screen readers announce it as "region" with no name, which is useless noise. `<div>` is semantically empty and AT ignores it — that's usually what you want for generic grouping.

**Fix:** `<section>` requires a heading or label to justify its use. If it doesn't have one, use `<div>`.

### Nested landmarks

Landmarks can nest — `<main>` containing an `<aside>` is fine. But nesting of same-role landmarks is not (a `<main>` inside a `<main>`, a `<nav>` inside a `<nav>`). Keep landmarks at peer-ish levels.

### Skip-link target that isn't a landmark

A skip link `<a href="#main">Skip to main</a>` targeting `<main id="main">` is the canonical pattern. A skip link targeting `<div id="content">` (not a landmark, no `tabindex`) also works but is weaker — the target needs `tabindex="-1"` so focus actually lands there.

---

## How to detect landmark issues from a component tree

During the detection spine, enumerate rendered components. For each, identify any landmark element (`<main>`, `<nav>`, `<aside>`, `<header>`, `<footer>`, `role="region"`, etc.) it renders.

Then ask:

1. **Is there exactly one `<main>`?** Zero = add one. Two or more = flag conflict; Fix is to consolidate, not add another.
2. **Are there multiple landmarks of the same role?** If yes, does each have an accessible name? If not, flag.
3. **Is every `role="region"` named?** If no, flag (unnamed regions are not landmarks).
4. **Does the view have >1 landmark?** If yes, is there a skip link? (Cross-check with `focus-flow.md`.)
5. **Are there `<header>` / `<footer>` that the developer intends as banner/contentinfo landmarks?** Check they're at the top level of the view, not nested.

### Grep strategies

For a view rooted at `src/routes/dashboard/`:

- `rg '<main' src/routes/dashboard/` — list all `<main>` elements.
- `rg '<nav|role="navigation"' src/routes/dashboard/` — list navs.
- `rg '<aside|role="complementary"' src/routes/dashboard/` — list asides.
- `rg 'role="region"' src/routes/dashboard/` — find regions; then grep each for `aria-label` / `aria-labelledby`.
- `rg 'aria-label(?:ledby)?' src/routes/dashboard/` — see which landmarks are labeled.

For React apps, remember that landmarks may come from imported shell components — expand the search to include the shell/layout path if `<AppShell>` or `<Layout>` is in use.

### When the grep is insufficient

- **Portals / teleports** (`ReactDOM.createPortal`, Vue `<Teleport>`, Svelte portals) render content OUTSIDE the DOM ancestor of the component. A `<main>` rendered via a portal at document-body level won't show up in a component-tree grep. Open the portal targets and include them in the enumeration.
- **Conditional rendering based on route** — a landmark rendered only on certain routes needs to be verified per route.
- **CMS / server-rendered content** — landmarks injected by the backend may not be in the frontend source tree. Inspect the rendered HTML or the backend template.

In all these cases, the enumeration is tree-based, not grep-based. Grep is a first pass; the detection spine's "enumerate rendered components" step is the authoritative list.
