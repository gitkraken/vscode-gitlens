/**
 * Which row the Ctrl-hold lane highlight walks its chain from.
 *
 * Purely focus/selection-seeded: the focused row wins (focus == selection in single-select; in
 * multi-select the focused row drives), and HEAD is the fallback when nothing is focused. The
 * pointer plays no part — hovering never seeds or retargets the highlight, so it stays stable
 * while scrolling or mousing around. It only moves when you navigate or select a different commit.
 */
export type LaneSeedTarget = { sha: string; origin: 'keyboard' | 'head' };

export interface LaneSeedInputs {
	/** The keyboard-focused row. */
	focusedSha?: string;
	/** Current HEAD — the fallback when no row is focused. */
	headSha?: string;
}

/** The seed to walk the lane chain from, or `undefined` when nothing at all is available (no focus, no HEAD). */
export function pickLaneSeed(inputs: LaneSeedInputs): LaneSeedTarget | undefined {
	if (inputs.focusedSha != null) return { sha: inputs.focusedSha, origin: 'keyboard' };

	return inputs.headSha != null ? { sha: inputs.headSha, origin: 'head' } : undefined;
}

/** Dedup key for the last-walked seed. */
export function laneSeedKey(target: LaneSeedTarget): string {
	return `row:${target.sha}`;
}
