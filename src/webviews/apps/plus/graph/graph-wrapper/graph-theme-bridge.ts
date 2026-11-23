import { LANE_PALETTE, setLanePalette } from '@gitkraken/commit-graph/lanes/colors.js';
import { formatHex, getCssVariable, parseColor } from '@gitlens/utils/color.js';

export function applyGraphThemeVariables(isLight: boolean, isHighContrast: boolean): boolean {
	const root = document.documentElement.style;

	// The two theme-KIND switches: no `--vscode-*` variable carries them, so they can't be static CSS.
	root.setProperty('--gl-graph-contrast-outline-width', isHighContrast ? '1px' : '0px');
	root.setProperty('--gl-graph-operation-ready-foreground', isLight ? '#fff' : '#06150a');

	return applyLanePalette(getComputedStyle(document.documentElement));
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
