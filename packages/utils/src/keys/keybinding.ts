import type { Chord, KeyEventLike } from './chord.js';
import { matchesChord, parseChord } from './chord.js';

/**
 * One item in a sheet row's key rail or subline, in a mini-grammar the renderer resolves:
 * - a bare chord (`'mod+KeyC'`, `'ArrowUp'`) — parsed and formatted into chips
 * - `'raw:X'` — literal `X` in a key chip
 * - `'mod:X'` — literal `X` in a modifier chip
 * - `'text:X'` — literal `X` as plain inline text, verbatim (leading/trailing spaces included)
 * - `'sep:X'` — literal `X` as a muted separator glyph
 */
export type SheetDisplayEntry = string;

export type SheetEntry = {
	group: string;
	label: string;
	order?: number;
	keysOverride?: readonly SheetDisplayEntry[];
	/** Second line rendered under the label — same display grammar as `keysOverride`. */
	subline?: readonly SheetDisplayEntry[];
};

export type KeyBindingDescriptor<TScope extends string, TEvent extends KeyEventLike = KeyEventLike> = {
	keys: readonly string[];
	scope: TScope;
	order?: number;
	when?: readonly ((e: TEvent) => boolean)[];
	run: (e: TEvent) => boolean;
	sheet: SheetEntry | 'hidden';
};

/** A registered binding: descriptor + parsed chords (parse once at registration). */
export type KeyBinding<TScope extends string, TEvent extends KeyEventLike = KeyEventLike> = KeyBindingDescriptor<
	TScope,
	TEvent
> & { chords: readonly Chord[] };

export type OverlayEntry = {
	id: string;
	/**
	 * Close the surface. Returns false to decline (surface decides it wasn't actually open/closable),
	 * letting resolution continue to the next overlay down, then the focus chain.
	 */
	onClose: () => boolean;
};

/**
 * Pure candidate selection: which bindings could handle this event, in resolution order —
 * scope chain innermost→outermost (chain[0] = innermost), `order` ascending within a scope
 * (undefined order sorts last), registration (array) order as the final tiebreak. Does NOT
 * evaluate `when` guards or call `run` — the dispatcher does that so scope guards can sit between.
 */
export function resolveKeydown<TScope extends string, TEvent extends KeyEventLike>(
	bindings: readonly KeyBinding<TScope, TEvent>[],
	scopeChain: readonly TScope[],
	e: KeyEventLike,
): KeyBinding<TScope, TEvent>[] {
	const matches: { binding: KeyBinding<TScope, TEvent>; scopeIndex: number; registrationIndex: number }[] = [];

	for (let i = 0; i < bindings.length; i++) {
		const binding = bindings[i];

		const scopeIndex = scopeChain.indexOf(binding.scope);
		if (scopeIndex === -1) continue;

		if (!binding.chords.some(chord => matchesChord(chord, e))) continue;

		matches.push({ binding: binding, scopeIndex: scopeIndex, registrationIndex: i });
	}

	matches.sort((a, b) => {
		if (a.scopeIndex !== b.scopeIndex) return a.scopeIndex - b.scopeIndex;

		const orderA = a.binding.order;
		const orderB = b.binding.order;
		if (orderA !== orderB) {
			if (orderA == null) return 1;
			if (orderB == null) return -1;

			return orderA - orderB;
		}

		return a.registrationIndex - b.registrationIndex;
	});

	return matches.map(m => m.binding);
}

/**
 * Pure overlay resolution for a close request (Esc): returns the entries to try, top of stack
 * first. The dispatcher calls onClose top-down until one returns true.
 */
export function resolveOverlayClose(stack: readonly OverlayEntry[]): OverlayEntry[] {
	return [...stack].reverse();
}

/** Parses a descriptor's keys into chords, throwing on the first malformed key. */
export function registerBinding<TScope extends string, TEvent extends KeyEventLike = KeyEventLike>(
	descriptor: KeyBindingDescriptor<TScope, TEvent>,
	isMac: boolean,
): KeyBinding<TScope, TEvent> {
	const chords: Chord[] = [];

	for (const key of descriptor.keys) {
		try {
			chords.push(parseChord(key, isMac));
		} catch (ex) {
			const reason = ex instanceof Error ? ex.message : String(ex);
			throw new Error(`Invalid key binding for scope '${descriptor.scope}', key '${key}': ${reason}`, {
				cause: ex,
			});
		}
	}

	return { ...descriptor, chords: chords };
}
