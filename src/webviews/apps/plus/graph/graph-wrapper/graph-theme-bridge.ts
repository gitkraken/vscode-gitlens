import { LANE_PALETTE, setLanePalette } from '@gitkraken/commit-graph/colors.js';
import type { Color } from '@gitlens/utils/color.js';
import { formatHex, getCssVariable, parseColor } from '@gitlens/utils/color.js';

const graphThemeVariables = [
	['--gl-graph-foreground', '--vscode-foreground', 'hsl(var(--foreground))'],
	['--gl-graph-background', '--vscode-editor-background', 'hsl(var(--background))'],
	['--gl-graph-font-family', '--vscode-editor-font-family', 'system-ui, sans-serif'],
	['--gl-graph-muted-foreground', '--vscode-descriptionForeground', 'hsl(var(--muted-foreground))'],
	['--gl-graph-focus', '--vscode-focusBorder', 'hsl(var(--brand))'],
	['--gl-graph-icon-foreground', '--vscode-icon-foreground', 'var(--gl-graph-foreground)'],
	['--gl-graph-selection', '--vscode-list-activeSelectionBackground', 'hsl(var(--brand) / 24%)'],
	['--gl-graph-selection-foreground', '--vscode-list-activeSelectionForeground', 'var(--gl-graph-foreground)'],
	['--gl-graph-selection-inactive', '--vscode-list-inactiveSelectionBackground', 'hsl(var(--brand) / 14%)'],
	[
		'--gl-graph-selection-inactive-foreground',
		'--vscode-list-inactiveSelectionForeground',
		'var(--gl-graph-foreground)',
	],
	['--gl-graph-hover', '--vscode-list-hoverBackground', 'hsl(var(--foreground) / 8%)'],
	['--gl-graph-focus-outline', '--vscode-list-focusOutline', 'var(--gl-graph-focus)'],
	['--gl-graph-inactive-focus-outline', '--vscode-list-inactiveFocusOutline', 'hsl(var(--brand) / 65%)'],
	['--gl-graph-elevated-background', '--vscode-editorWidget-background', 'hsl(var(--secondary))'],
	['--gl-graph-elevated-border', '--vscode-editorWidget-border', 'hsl(var(--border))'],
	['--gl-graph-border', '--vscode-widget-border', 'hsl(var(--border))'],
	['--gl-graph-shadow', '--vscode-widget-shadow', 'rgb(0 0 0 / 35%)'],
	['--gl-graph-toolbar-hover', '--vscode-toolbar-hoverBackground', 'var(--gl-graph-hover)'],
	['--gl-graph-code-background', '--vscode-textCodeBlock-background', 'var(--gl-graph-elevated-background)'],
	['--gl-graph-link', '--vscode-textLink-foreground', 'hsl(var(--brand))'],
	['--gl-graph-link-active', '--vscode-textLink-activeForeground', 'hsl(var(--brand) / 85%)'],
	['--gl-graph-button-background', '--vscode-button-background', 'hsl(var(--brand))'],
	['--gl-graph-button-foreground', '--vscode-button-foreground', 'white'],
	['--gl-graph-button-hover', '--vscode-button-hoverBackground', 'hsl(var(--brand) / 85%)'],
	['--gl-graph-scrollbar-background', '--vscode-scrollbarSlider-background', 'hsl(var(--foreground) / 18%)'],
	[
		'--gl-graph-scrollbar-hover-background',
		'--vscode-scrollbarSlider-hoverBackground',
		'hsl(var(--foreground) / 28%)',
	],
	[
		'--gl-graph-scrollbar-active-background',
		'--vscode-scrollbarSlider-activeBackground',
		'hsl(var(--foreground) / 38%)',
	],
	['--gl-graph-sash-hover-border', '--vscode-sash-hoverBorder', 'var(--gl-graph-focus)'],
	['--gl-graph-purple', '--vscode-charts-purple', '#a371f7'],
	['--gl-graph-added-foreground', '--vscode-gitDecoration-addedResourceForeground', '#3fb950'],
	['--gl-graph-deleted-foreground', '--vscode-gitDecoration-deletedResourceForeground', '#f85149'],
	['--gl-graph-search-match-background', '--vscode-editor-findMatchHighlightBackground', 'hsl(var(--brand) / 55%)'],
	['--gl-graph-range-highlight-background', '--vscode-editor-rangeHighlightBackground', 'hsl(var(--brand) / 20%)'],
	['--gl-graph-range-highlight-border', '--vscode-editor-rangeHighlightBorder', 'transparent'],
	['--gl-graph-pr-open-color', '--vscode-gitlens-openPullRequestIconColor', '#3fb950'],
	['--gl-graph-pr-merged-color', '--vscode-gitlens-mergedPullRequestIconColor', '#a371f7'],
	['--gl-graph-pr-closed-color', '--vscode-gitlens-closedPullRequestIconColor', '#f85149'],
	[
		'--gl-graph-operation-active-color',
		'--vscode-gitlens-decorations.statusMergingOrRebasingForegroundColor',
		'#d29922',
	],
	[
		'--gl-graph-operation-conflict-color',
		'--vscode-gitlens-decorations.statusMergingOrRebasingConflictForegroundColor',
		'#f85149',
	],
	[
		'--gl-graph-operation-ready-color',
		'--vscode-gitlens-decorations.statusPausedOperationReadyForegroundColor',
		'#3fb950',
	],
] as const;

/**
 * Maps the VS Code theme onto the CSS custom properties consumed by the commit-graph
 * engine and host-neutral renderer packages. Direct `--gl-graph-*` aliases preserve the
 * renderer's existing VS Code colors without adding the optional VS Code adapter to GitLens CSS.
 *
 * commit-graph expects each token as an HSL triplet (e.g. `217 91% 60%`) so its Tailwind utility
 * classes can compose `hsl(var(--brand))` and `hsl(var(--brand) / 0.12)`. VS Code provides
 * raw color values, so we resolve them via getComputedStyle and convert to HSL components.
 *
 * Translucent theme colors are composited onto the editor background FIRST (see `toHslTriplet`). The
 * triplet has no room for alpha — consumers append their own `/ N` — so dropping it instead collapsed
 * dim tokens onto their solid counterparts: VS Code defines dark `descriptionForeground` as
 * `transparent(foreground, 0.7)`, so `--muted-foreground` came out identical to (or brighter than)
 * `--foreground` and nothing muted actually looked muted. Flattening yields the color VS Code paints.
 *
 * Vars set on `:root`:
 *   --brand            selection / focus / HEAD chip
 *   --border           chip / popover borders
 *   --secondary        hover background, remote ref chip
 *   --background       popover / menu surface
 *   --foreground       text
 *   --muted-foreground dim text (sha, date)
 *   --status-warning   tag ref chip
 *
 * The runtime values defined here override the static defaults imported from
 * `@gitkraken/commit-graph/theme.css` so the graph picks up theme switches.
 *
 * Also resolves the theme's `gitlens.graphLaneNColor` contributions (package.json defaults: dark and
 * highContrast use the engine's balanced OKLCH set, light keeps the classic saturated set) into the
 * engine's active lane palette (see `applyLanePalette`). Returns whether the lane palette actually
 * changed, so the caller can invalidate lane-colored adornment caches only when it matters.
 */
export function applyGraphThemeVariables(): boolean {
	const computed = getComputedStyle(document.documentElement);
	const root = document.documentElement.style;
	for (const [target, source, fallback] of graphThemeVariables) {
		root.setProperty(target, `var(${source}, ${fallback})`);
	}

	const isHighContrast =
		document.body.classList.contains('vscode-high-contrast') ||
		document.body.classList.contains('vscode-high-contrast-light');
	const isLight =
		document.body.classList.contains('vscode-light') ||
		document.body.classList.contains('vscode-high-contrast-light');
	root.setProperty('--gl-graph-contrast-outline-width', isHighContrast ? '1px' : '0px');
	root.setProperty('--gl-graph-operation-ready-foreground', isLight ? '#fff' : '#06150a');

	const tokens: Record<string, readonly string[]> = {
		'--brand': ['--vscode-button-background', '--vscode-focusBorder', '--vscode-textLink-foreground'],
		'--border': ['--vscode-panel-border', '--vscode-widget-border', '--vscode-input-border'],
		'--secondary': ['--vscode-list-hoverBackground', '--vscode-toolbar-hoverBackground'],
		'--background': ['--vscode-editor-background'],
		'--foreground': ['--vscode-editor-foreground', '--vscode-foreground'],
		'--muted-foreground': ['--vscode-descriptionForeground', '--vscode-disabledForeground'],
		'--status-warning': ['--vscode-editorWarning-foreground', '--vscode-list-warningForeground'],
	};

	// Resolved once for the whole pass — the surface every one of these tokens is ultimately painted on.
	// `parseColor` (not `Color.from`, which falls back to RED) so an unresolvable background stays null and
	// simply skips the compositing.
	const background = parseColor(getCssVariable('--vscode-editor-background', computed));

	for (const [themeVar, vscodeCandidates] of Object.entries(tokens)) {
		const triplet = resolveTriplet(computed, vscodeCandidates, background);
		if (triplet != null) {
			root.setProperty(themeVar, triplet);
		}
	}

	return applyLanePalette(computed);
}

// The 10 lane colors VS Code exposes as `--vscode-gitlens-graphLaneNColor` (from the
// `gitlens.graphLaneNColor` color contributions in package.json).
function laneColorVariable(index: number): string {
	return `--vscode-gitlens-graphLane${index + 1}Color`;
}

/**
 * Resolves the theme's lane colors and pushes them into the engine's active palette (`setLanePalette`).
 * Each VS Code lane color is validated as a parseable color, applied verbatim, and falls back per-lane
 * to the built-in `LANE_PALETTE` default when it isn't parseable; `LANE_PALETTE` itself is already hex
 * (`buildLanePalette` bakes the OKLCH tuning down to `#RRGGBB` at module-load time), so no OKLCH-vs-hex
 * branching is needed here — `contrastColor`/`withAlpha` only ever see hex.
 *
 * No softening: the `gitlens.graphLaneNColor` contribution DEFAULTS (package.json) already curate a
 * per-theme-kind palette — dark/highContrast default to the engine's balanced OKLCH set, light keeps the
 * classic, more saturated set so it doesn't wash out on a bright background — so applying a further
 * runtime blend here would double up on that curation. A genuinely customized (user-set) lane color also
 * applies verbatim.
 */
function applyLanePalette(computed: CSSStyleDeclaration): boolean {
	const resolved = LANE_PALETTE.map((fallback, i) => {
		const raw = getCssVariable(laneColorVariable(i), computed);
		const parsed = raw.length > 0 ? parseColor(raw) : null;
		return parsed != null ? formatHex(parsed) : fallback;
	});

	return setLanePalette(resolved);
}

function resolveTriplet(
	computed: CSSStyleDeclaration,
	candidates: readonly string[],
	background: Color | null,
): string | undefined {
	for (const variable of candidates) {
		const value = getCssVariable(variable, computed);
		if (!value) continue;

		const triplet = toHslTriplet(value, background);
		if (triplet != null) return triplet;
	}
	return undefined;
}

function toHslTriplet(value: string, background: Color | null): string | undefined {
	try {
		// `parseColor` (not `Color.from`) so an unparseable value returns null and `resolveTriplet` falls
		// through to the next candidate, instead of silently pinning the token to `Color.red`.
		let color = parseColor(value);
		if (color == null) return undefined;

		// `makeOpaque` no-ops when the color is already opaque or the background isn't, so this is safe to
		// apply unconditionally.
		if (background != null) {
			color = color.makeOpaque(background);
		}

		const { h, s, l } = color.hsla;
		return `${h} ${(s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}%`;
	} catch {
		return undefined;
	}
}
