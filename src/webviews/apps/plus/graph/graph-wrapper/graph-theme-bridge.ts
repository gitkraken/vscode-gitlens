import { LANE_PALETTE, setLanePalette } from '@gitkraken/commit-graph/colors.js';
import { Color, formatHex, getCssVariable, parseColor } from '@gitlens/utils/color.js';

/**
 * Maps the VS Code theme onto the CSS custom properties consumed by the commit-graph
 * `@gitkraken/commit-graph` package.
 *
 * commit-graph expects each token as an HSL triplet (e.g. `217 91% 60%`) so its Tailwind utility
 * classes can compose `hsl(var(--brand))` and `hsl(var(--brand) / 0.12)`. VS Code provides
 * raw color values, so we resolve them via getComputedStyle and convert to HSL components.
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

	const tokens: Record<string, readonly string[]> = {
		'--brand': ['--vscode-button-background', '--vscode-focusBorder', '--vscode-textLink-foreground'],
		'--border': ['--vscode-panel-border', '--vscode-widget-border', '--vscode-input-border'],
		'--secondary': ['--vscode-list-hoverBackground', '--vscode-toolbar-hoverBackground'],
		'--background': ['--vscode-editor-background'],
		'--foreground': ['--vscode-editor-foreground', '--vscode-foreground'],
		'--muted-foreground': ['--vscode-descriptionForeground', '--vscode-disabledForeground'],
		'--status-warning': ['--vscode-editorWarning-foreground', '--vscode-list-warningForeground'],
	};

	for (const [themeVar, vscodeCandidates] of Object.entries(tokens)) {
		const triplet = resolveTriplet(computed, vscodeCandidates);
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

function resolveTriplet(computed: CSSStyleDeclaration, candidates: readonly string[]): string | undefined {
	for (const variable of candidates) {
		const value = getCssVariable(variable, computed);
		if (!value) continue;

		const triplet = toHslTriplet(value);
		if (triplet != null) return triplet;
	}
	return undefined;
}

function toHslTriplet(value: string): string | undefined {
	try {
		const color = Color.from(value);
		if (color == null) return undefined;

		const { h, s, l } = color.hsla;
		return `${h} ${(s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}%`;
	} catch {
		return undefined;
	}
}
