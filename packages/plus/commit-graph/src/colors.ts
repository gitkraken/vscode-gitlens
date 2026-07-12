// Lane palette tuning — all lanes share ONE perceptual lightness (OKLCH L) and differ only by hue, so
// no lane reads brighter than another (the old hand-picked hexes ranged ~0.35–0.6 WCAG luminance, which
// made the bright ones dominate + over-bleed in the band gradient). Each lane is as VIVID as possible:
// its chroma is pushed to `chromaTarget` but capped at the sRGB gamut boundary for its hue at the given
// lightness — so nothing clamps (clamping would desaturate + drift brightness).
//
// Two tuned presets — flip `lanePalette` to switch + compare:
//   • balanced — brighter, gentler saturation (the preferred "lighter" set).
//   • vibrant  — lower lightness pushed to a higher chroma for punchier lanes.
// Raise `lightness` for brighter/less-saturated lanes; raise `chromaTarget` for more vivid.
const lanePalettePresets = {
	balanced: { lightness: 0.78, chromaTarget: 0.15 },
	vibrant: { lightness: 0.74, chromaTarget: 0.22 },
} as const;
const laneHueStart = 195;
const laneCount = 10;

// OKLCH → linear sRGB (Björn Ottosson's OKLab matrices).
function oklchToLinearSrgb(l: number, c: number, hueDeg: number): [number, number, number] {
	const h = (hueDeg * Math.PI) / 180;
	const a = c * Math.cos(h);
	const b = c * Math.sin(h);

	const lp = l + 0.3963377774 * a + 0.2158037573 * b;
	const mp = l - 0.1055613458 * a - 0.0638541728 * b;
	const sp = l - 0.0894841775 * a - 1.291485548 * b;
	const l3 = lp * lp * lp;
	const m3 = mp * mp * mp;
	const s3 = sp * sp * sp;

	return [
		4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
		-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
		-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
	];
}

function linearToGamma(linear: number): number {
	return linear <= 0.0031308 ? 12.92 * linear : 1.055 * Math.max(linear, 0) ** (1 / 2.4) - 0.055;
}

// True when every channel sits inside the sRGB gamut (small epsilon for float slop).
function inSrgbGamut(l: number, c: number, hueDeg: number): boolean {
	return oklchToLinearSrgb(l, c, hueDeg).every(v => {
		const g = linearToGamma(v);
		return g >= -0.0005 && g <= 1.0005;
	});
}

// Largest in-gamut chroma for a hue at a given lightness (binary search on the gamut boundary).
function maxChromaForLightnessHue(l: number, hueDeg: number): number {
	let lo = 0;
	let hi = 0.4; // beyond any sRGB chroma
	for (let i = 0; i < 28; i++) {
		const mid = (lo + hi) / 2;
		if (inSrgbGamut(l, mid, hueDeg)) {
			lo = mid;
		} else {
			hi = mid;
		}
	}

	return lo;
}

function oklchToHex(l: number, c: number, hueDeg: number): string {
	const toByte = (linear: number): string =>
		Math.round(Math.max(0, Math.min(1, linearToGamma(linear))) * 255)
			.toString(16)
			.padStart(2, '0');
	const [r, g, b] = oklchToLinearSrgb(l, c, hueDeg);
	return `#${toByte(r)}${toByte(g)}${toByte(b)}`.toUpperCase();
}

/**
 * Lane palette — every lane at the SAME OKLCH lightness, hues evenly spaced (starting near teal), each
 * pushed to its most-vivid in-gamut chroma (capped at `laneChromaTarget`). Equal perceived luminance
 * means no lane visually dominates or over-bleeds; hue + chroma distinguish them.
 *
 * Exported so adornment providers (e.g. ref chips) can match the row's lane color and keep visual
 * continuity between the lane gutter and any per-row UI.
 */
function buildLanePalette(preset: { lightness: number; chromaTarget: number }): string[] {
	return Array.from({ length: laneCount }, (_, i) => {
		const hue = laneHueStart + (360 / laneCount) * i;
		// 0.98 keeps a hair off the boundary so rounding never clamps (which would desaturate).
		const c = Math.min(preset.chromaTarget, maxChromaForLightnessHue(preset.lightness, hue) * 0.98);
		return oklchToHex(preset.lightness, c, hue);
	});
}

// Active palette — `balanced` is the chosen set; swap to `lanePalettePresets.vibrant` to retry the
// punchier (lower-lightness, higher-chroma) set.
export const LANE_PALETTE: readonly string[] = buildLanePalette(lanePalettePresets.balanced);

// The palette `colorForColumn` reads — swappable so a host (e.g. the webview's theme bridge) can
// override lanes with the VS Code theme's `gitlens.graphLaneNColor` contributions. Defaults to the
// built-in OKLCH set.
let activePalette: readonly string[] = LANE_PALETTE;

/**
 * Swap the active lane palette; `undefined` resets to the built-in `LANE_PALETTE` default. Returns
 * whether the active palette actually changed (element-wise compare) so a caller can skip a repaint
 * when the resolved colors are identical to what's already active.
 */
export function setLanePalette(colors: readonly string[] | undefined): boolean {
	const next = colors ?? LANE_PALETTE;
	if (next.length === activePalette.length && next.every((c, i) => c === activePalette[i])) return false;

	activePalette = next;
	return true;
}

export function colorForColumn(column: number): string {
	return activePalette[column % activePalette.length];
}

/**
 * Best-contrast text color (black or white) for text/icons placed ON a solid `hex` fill — using the
 * WCAG relative-luminance of the fill. Light lanes (amber/gold/green/teal) get dark text, dark lanes
 * get white. Lets filled lane chips drop the text-shadow halo and just use a readable color.
 */
export function contrastColor(hex: string): string {
	const channel = (start: number) => {
		const c = parseInt(hex.slice(start, start + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
	return luminance > 0.4 ? '#000000' : '#ffffff';
}

/**
 * Append a 2-digit hex alpha to a 6-digit hex color (e.g. `withAlpha('#22D3EE', 0.15)` →
 * `'#22D3EE26'`). Used by lane-colored UI (chips, marker pips, glows) to derive a tint
 * without manual `${color}26` hex-fragment juggling at call sites.
 */
export function withAlpha(hex: string, alpha: number): string {
	const clamped = Math.max(0, Math.min(1, alpha));
	const byte = Math.round(clamped * 255)
		.toString(16)
		.padStart(2, '0');
	return `${hex}${byte}`;
}
