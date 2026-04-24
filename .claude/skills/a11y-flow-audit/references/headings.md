# Headings — Hierarchy Rules and Skip-Link Patterns

**Why this file exists:** Headings are the second most-used navigation tool for screen-reader users, right after landmarks. Pressing `H` (NVDA) or `VO+Cmd+H` (VoiceOver) jumps heading-to-heading. A broken hierarchy turns that jump into a disoriented walk — "next heading" puts the user somewhere they didn't expect.

Headings and landmarks solve different problems:

- **Landmarks** identify top-level regions of the view (nav, main, aside). Small number, broad scope.
- **Headings** structure the CONTENT inside those regions. Large number, fine-grained.

Flow audits check that both are healthy and that they agree with each other (e.g., `<main>` contains the `<h1>`, not the nav).

---

## Heading hierarchy rules

### One `<h1>` per view (strong default)

The HTML5 spec technically allows multiple `<h1>`s inside `<section>` / `<article>` with automatic "outlining." In practice, no browser implements the outline algorithm, and screen readers treat `<h1>` as a top-level heading regardless of nesting. **Default rule for flow audits: exactly one `<h1>` per view**, representing the primary subject of the view.

Exceptions:

- **App shells that host nested pages** — the shell's `<h1>` is the app name; the inner page adds its own "page title" as `<h1>` too. Both visible = two `<h1>`s. The more common fix is: shell uses the app name as `<h1>` only on the landing/home view; on inner routes, the app name is a visual header without `<h1>` semantics, and the page owns the `<h1>`.
- **Documentation or long-form content with multiple articles on one view** — each article's title may be `<h1>` within the article's outline. In practice, make each an `<h2>` unless there's a strong reason.

### Descending levels only (no skips)

After `<h1>`, the next level used is `<h2>`. After `<h2>`, either another `<h2>` or `<h3>`. You cannot skip levels going DOWN (no `<h1>` → `<h3>`). You CAN skip levels going UP (after `<h4>`, the next heading can be `<h2>`).

**Why:** screen-reader heading navigation relies on the level number for "go up one level" / "go down one level" commands. A skip down creates a hole; the user reaches `<h3>` thinking it's a child of some `<h2>` that doesn't exist.

### Heading level expresses STRUCTURE, not visual style

If a visual designer asks for a small-looking heading that's actually at a high structural level, the element is `<h2 class="small-heading">`, NOT `<h4>`. Heading level is for AT; styling is for CSS. Mixing them breaks the AT tree for visual appearance.

**Banned pattern:** choosing `<h4>` because "it looks right in the design." Choose the level that matches the content's depth in the document outline, then style it to match the design.

### Empty / whitespace-only headings are banned

`<h2></h2>` or `<h2> </h2>` makes AT announce an empty heading, which is confusing noise. If the heading wrapper is there for spacing/layout, use a `<div>` instead.

---

## How heading level disagrees with visual style — and why that's a code smell

When you find `<h4>` visually styled to look like a small caption, the usual cause is one of:

1. **The component was ported from a design system without semantic review** — the designer chose a visual level; the dev mapped it to a heading level to get the style.
2. **The component is being used in a context it wasn't designed for** — an `<h3>` in a sidebar was the right level for sidebars at the top of a page, but wrong when the sidebar got nested inside a card.
3. **Someone used heading levels as a font-size knob** — increasing/decreasing the number to get different sizes.

All three are signals the heading system needs to be either decoupled from style (use a `<Heading level={2} visualSize="small">` component pattern) or the component's style needs to adapt to the heading level it's given.

---

## Detecting heading issues from a composed view

### Enumerate all headings in scope

During the detection spine:

1. Grep the view for `<h1>` through `<h6>` — include imported components rendered in the view.
2. For frameworks that use Heading components (`<Heading level={2}>`, `<Title as="h3">`), grep those too.
3. Order the list by DOM position (as best you can from reading the source).
4. Write out the sequence: `h1, h2, h2, h3, h2, h4, h2`.

### Check the sequence

For each heading level in the sequence, check:

- Does it follow a descending pattern (no skipping down)?
- Is the `<h1>` unique?
- Does any heading nested inside a landmark have a level that conflicts with the landmark's expected outline? (E.g., `<aside>` containing `<h1>` is almost always wrong — the aside is supplementary, its heading should be `<h2>` or `<h3>`.)
- Is the heading TEXT descriptive? (Two `<h2>Details</h2>` in the same view is legal but ambiguous — 2.4.6 Headings and Labels can fail on label vagueness.)

### Confirm which component owns each heading

For flow audits to hand fixes back to the right component, the finding must specify WHICH component renders the problematic heading. Grep the heading element in its source file; name the file in the finding.

### Grep strategies

```bash
rg '<h[1-6]|<Heading|<Title' src/routes/dashboard/
```

If the view imports a shared `Heading` / `SectionTitle` / `PageHeader` component, expand the search to that component's source and look at what HTML it renders.

### When level-agnostic Heading components exist

Some design systems use level-agnostic headings like `<Heading level={depth}>` where `depth` is a prop. The flow audit must trace what `depth` resolves to at the call site. If `depth` is derived from a context provider that tracks current section depth, the audit should note that the depth-logic is the source of truth.

---

## Skip-link patterns

### When skip links are required

WCAG 2.4.1 Bypass Blocks requires a bypass mechanism when repeated content appears across pages. In practice, flow audits require skip links when:

- The view has more than one landmark, AND
- One or more landmarks contain many focusable elements a keyboard user would have to Tab through to reach `<main>`.

A view with only `<main>` needs no skip link — there's nothing to skip.

A view with `<header>` + `<nav>` + `<main>` needs a skip link. Without it, every keyboard user presses Tab repeatedly through the header/nav on every page load.

### Canonical skip-link pattern

```html
<a href="#main-content" class="skip-link">Skip to main content</a>
...
<main id="main-content" tabindex="-1">...</main>
```

Key points:

- **First focusable element in the DOM.** Must be the first thing Tab reaches.
- **`href="#main-content"`** — targets the `id` of the primary landmark.
- **`tabindex="-1"` on the target.** Without it, clicking the skip link moves the hash but focus doesn't follow. (Modern browsers sometimes handle this; `tabindex="-1"` makes it explicit.)
- **Visible on focus.** The skip link is visually hidden until it receives focus, then appears on-screen. See styling below.

### Visibility: visually hidden until focus

```css
.skip-link {
	position: absolute;
	left: -9999px;
	top: 0;
	/* when focused, bring it into view */
}
.skip-link:focus {
	left: 0;
	background: #000;
	color: #fff;
	padding: 0.5rem 1rem;
	z-index: 1000;
}
```

**Alternatives** — modern options are preferable to `left: -9999px`:

```css
.skip-link {
	position: absolute;
	clip: rect(0 0 0 0);
	clip-path: inset(50%);
	width: 1px;
	height: 1px;
	overflow: hidden;
	white-space: nowrap;
}
.skip-link:focus {
	clip: auto;
	clip-path: none;
	width: auto;
	height: auto;
	white-space: normal;
	/* plus visible styling */
}
```

### Multiple skip links

Views with many landmarks may have a small skip-link block at the top:

```html
<ul class="skip-links">
	<li><a href="#main">Skip to main content</a></li>
	<li><a href="#nav-sections">Skip to section nav</a></li>
	<li><a href="#search">Skip to search</a></li>
</ul>
```

All targets need `tabindex="-1"`. Keep the list short — 2-4 skip links is typical; 6+ becomes its own Tab target burden.

### Skip-link anti-patterns

- **Skip link that targets `<div>` with no `tabindex`** — focus won't follow.
- **Skip link hidden with `display: none`** — not focusable at all. Skip links must be in the a11y tree, just visually out of view.
- **Skip link placed after header content** — must be first focusable element. Otherwise the user Tabs through half the header before reaching it.
- **Skip link that's announced by a screen reader but not by keyboard users** (because it was added with `aria-label` and `display: none`) — it must be a real focusable element.
- **Skip link that scrolls but does not move focus** — `scrollIntoView` alone is insufficient; focus must move for keyboard users to continue from the new location.

### Alternative: well-labeled landmarks can substitute for skip links

If the view has clear, well-labeled landmarks and the user's AT provides landmark navigation (most screen readers do), a skip link becomes less critical — the user can jump to `<main>` via the rotor. However:

- Landmark navigation isn't available to keyboard-only users who don't use AT.
- The WCAG Understanding doc recommends skip links as the belt-and-suspenders default.

Flow audits default to recommending skip links when the view has multiple landmarks. If the team has a team-level decision to rely on landmarks-only, note it as a Design Decision rather than auto-flagging as a P1.

---

## Heading-and-landmark agreement

A healthy view has headings and landmarks that agree:

- `<h1>` is inside `<main>`, not inside `<nav>` or `<header>`.
- The `<h2>`s in `<main>` are the major sections of the primary content.
- The `<h2>`s in `<aside>` label the aside's content.
- Headings INSIDE a labeled landmark don't need to repeat the landmark's label — `<nav aria-label="Primary"> <h2>Primary</h2>` is redundant. Pick one.

Flow audits flag disagreement:

- `<h1>` in `<header>` that's NOT the page's primary heading — usually P2 (degrades AT navigation).
- `<h1>` in `<aside>` — almost always wrong.
- No `<h1>` in `<main>` (or no `<h1>` anywhere in the view) — usually P1.
