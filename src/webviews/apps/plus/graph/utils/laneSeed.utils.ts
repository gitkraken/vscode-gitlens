/**
 * Which row the Alt-hold lane highlight walks its chain from.
 *
 * Two inputs can name a row — the pointer (a hovered ref pill or row) and the keyboard (the focused
 * row) — and they drift apart constantly: click a row, arrow five rows down, and the pointer still
 * sits on the row you left. So the LAST one to move wins, and the other becomes the fallback. HEAD is
 * the final fallback, which is what makes a bare Alt-hold with the pointer off the rows still say
 * "here's the branch you're on" instead of doing nothing.
 */
export type LaneSeedSource = 'pointer' | 'keyboard';

/** The chosen seed. A pill seed walks DOWN-only (a ref IS its lane tip); a row seed walks BOTH ways. */
export type LaneSeedTarget =
	| { kind: 'pill'; key: string; sha: string }
	| { kind: 'row'; sha: string; origin: 'pointer' | 'keyboard' | 'head' };

export interface LaneSeedInputs {
	/** Which input last named a row. Decides whose candidates are tried first, not which ones exist. */
	source: LaneSeedSource;
	/** Ref pill under the pointer, if any — the richest pointer seed (its chain covers the tracked counterpart). */
	pillRef?: { key: string; sha: string };
	/** Row under the pointer (the rich-hover row, or the row whose affordance the pointer is on). */
	pointerSha?: string;
	/** The keyboard-focused row. */
	focusedSha?: string;
	/** Current HEAD — the fallback when neither input names a row. */
	headSha?: string;
}

/** The seed to walk the lane chain from, or `undefined` when nothing at all is available (no rows, no HEAD). */
export function pickLaneSeed(inputs: LaneSeedInputs): LaneSeedTarget | undefined {
	const pointerFirst = inputs.source === 'pointer';

	if (pointerFirst) {
		const pointer = pickPointerSeed(inputs);
		if (pointer != null) return pointer;
	}

	if (inputs.focusedSha != null) return { kind: 'row', sha: inputs.focusedSha, origin: 'keyboard' };

	if (!pointerFirst) {
		const pointer = pickPointerSeed(inputs);
		if (pointer != null) return pointer;
	}

	return inputs.headSha != null ? { kind: 'row', sha: inputs.headSha, origin: 'head' } : undefined;
}

function pickPointerSeed(inputs: LaneSeedInputs): LaneSeedTarget | undefined {
	if (inputs.pillRef != null) return { kind: 'pill', key: inputs.pillRef.key, sha: inputs.pillRef.sha };

	return inputs.pointerSha != null ? { kind: 'row', sha: inputs.pointerSha, origin: 'pointer' } : undefined;
}

/** Dedup key for the last-walked seed. Deliberately NOT keyed on `origin`: the same row reached by the
 *  pointer and by the keyboard is the same chain, so drifting between them must not force a re-walk. */
export function laneSeedKey(target: LaneSeedTarget): string {
	return target.kind === 'pill' ? `pill:${target.key}:${target.sha}` : `row:${target.sha}`;
}
