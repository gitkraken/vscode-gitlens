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

/**
 * Another binding this row also presents keys for — typically the `sheet: 'hidden'` partner of a
 * "previous / next" pair, so overriding either half's keys still shows up here.
 */
export type SheetPartner = {
	id: string;
	/** Display entries for this partner when it is NOT overridden — defaults to its keys. */
	keys?: readonly SheetDisplayEntry[];
};

export type SheetEntry = {
	group: string;
	label: string;
	order?: number;
	/** The visible binding's OWN keys — a partner's keys are never included here, see `with`. */
	keysOverride?: readonly SheetDisplayEntry[];
	/** Second line rendered under the label — same display grammar as `keysOverride`. */
	subline?: readonly SheetDisplayEntry[];
	with?: readonly SheetPartner[];
};

export type KeyBindingDescriptor<TScope extends string, TEvent extends KeyEventLike = KeyEventLike> = {
	/**
	 * Stable dotted identifier, e.g. `'rows.stepPrevious'` — the key overrides are keyed by this.
	 * Present only on customizable bindings (those a user could collide with or reasonably want to
	 * change); user overrides key on it and the sheet shows it. Absent = fixed widget key: never
	 * overridden, never disabled.
	 */
	id?: string;
	keys: readonly string[];
	scope: TScope;
	order?: number;
	when?: readonly ((e: TEvent) => boolean)[];
	/**
	 * `chordIndex` is the index into this binding's effective `keys`/`chords` of the chord that
	 * matched the event — e.g. for `keys: ['Digit1', …, 'Digit0']`, pressing `Digit3` runs with
	 * `chordIndex === 2`.
	 */
	run: (e: TEvent, chordIndex: number) => boolean;
	sheet: SheetEntry | 'hidden';
};

/** A registered binding: descriptor + parsed chords (parse once at registration). */
export type KeyBinding<TScope extends string, TEvent extends KeyEventLike = KeyEventLike> = KeyBindingDescriptor<
	TScope,
	TEvent
> & { chords: readonly Chord[]; /** True when the effective keys came from an override. */ overridden: boolean };

/**
 * User overrides keyed by binding id: a replacement key list, or `false` to disable. A key ending in
 * `.*` matches every id with that prefix (e.g. `'panels.*'`); an exact id wins over a wildcard, and a
 * longer wildcard wins over a shorter one. `'*'` matches everything. A wildcard can only disable — a
 * wildcard entry with a non-empty key list is ignored (see {@link resolveOverride}); only an exact id
 * can rebind.
 */
export type KeyBindingOverrides = Readonly<Record<string, readonly string[] | false>>;

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

/**
 * Resolves what a binding's effective keys should be given an override map: the replacement key
 * list, `false` if disabled, or `undefined` if nothing in `overrides` applies. An exact id match
 * always wins (and may rebind or disable); otherwise the longest matching `'<prefix>.*'` wildcard
 * wins, with bare `'*'` (an empty prefix) matching everything as the fallback — but a wildcard can
 * ONLY disable: a wildcard entry whose value is a non-empty key list is ignored entirely (it never
 * becomes a candidate), falling through to the next matching wildcard, then `undefined`. An override
 * value that is an empty array is treated the same as `false`.
 */
export function resolveOverride(
	id: string,
	overrides: KeyBindingOverrides | undefined,
): readonly string[] | false | undefined {
	if (!overrides) return undefined;

	if (Object.hasOwn(overrides, id)) return normalizeOverrideValue(overrides[id]);

	let bestPrefixLength: number | undefined;
	let bestValue: readonly string[] | false | undefined;

	for (const key of Object.keys(overrides)) {
		let prefix: string;
		if (key === '*') {
			prefix = '';
		} else if (key.endsWith('.*')) {
			prefix = key.slice(0, -2);
			if (!id.startsWith(`${prefix}.`)) continue;
		} else {
			continue;
		}

		const raw = overrides[key];
		// Wildcards can only disable — one with a non-empty key list can't rebind, so it's ignored.
		if (raw !== false && raw.length > 0) continue;

		if (bestPrefixLength === undefined || prefix.length > bestPrefixLength) {
			bestPrefixLength = prefix.length;
			bestValue = normalizeOverrideValue(raw);
		}
	}

	return bestValue;
}

function normalizeOverrideValue(value: readonly string[] | false): readonly string[] | false {
	return value === false || value.length === 0 ? false : value;
}

/**
 * True when every chord in `chords` that has `shift === false` has a twin elsewhere in the list
 * identical in `token`/`matchOn`/`ctrl`/`alt`/`meta` with `shift === true` — e.g. `['ArrowUp',
 * 'shift+ArrowUp']`. Chords with `shift === 'implicit'` (a single printable-character token, whose
 * shifted form already encodes the shift state) are ignored, both as candidates needing a twin and
 * as candidate twins.
 */
export function isShiftClosed(chords: readonly Chord[]): boolean {
	for (const chord of chords) {
		if (chord.shift !== false) continue;

		const hasTwin = chords.some(
			other =>
				other !== chord &&
				other.shift === true &&
				other.token === chord.token &&
				other.matchOn === chord.matchOn &&
				other.ctrl === chord.ctrl &&
				other.alt === chord.alt &&
				other.meta === chord.meta,
		);
		if (!hasTwin) return false;
	}

	return true;
}

/** Appends a `shift: true` twin right after every `shift: false` chord in `chords`; chords with
 *  `shift === true` or `'implicit'` pass through unchanged with no twin added. */
export function withShiftTwins(chords: readonly Chord[]): Chord[] {
	const result: Chord[] = [];
	for (const chord of chords) {
		result.push(chord);
		if (chord.shift === false) {
			result.push({ ...chord, shift: true });
		}
	}

	return result;
}

/** Parses a list of keys into chords, throwing on the first malformed key. */
function parseKeys(keys: readonly string[], errorContext: string, isMac: boolean): Chord[] {
	const chords: Chord[] = [];

	for (const key of keys) {
		try {
			chords.push(parseChord(key, isMac));
		} catch (ex) {
			const reason = ex instanceof Error ? ex.message : String(ex);
			throw new Error(`${errorContext}, key '${key}': ${reason}`, { cause: ex });
		}
	}

	return chords;
}

/**
 * Parses a descriptor's keys into chords, applying `overrides` (keyed by {@link KeyBindingDescriptor.id})
 * first. A binding with no `id` is fixed — it never consults `overrides` at all, so it can't be
 * rebound or disabled (not even by a `'*'` wildcard). A disabled binding (`false`) is never
 * registered — this returns `undefined` and the caller skips it. A malformed replacement chord is
 * reported to `onWarn` (naming the id and the bad key) and the descriptor's default keys are used
 * instead. Malformed default keys still throw, as before.
 *
 * When an override applies and the descriptor's DEFAULT chords are "Shift-closed" (see
 * {@link isShiftClosed}) — e.g. `['ArrowUp', 'shift+ArrowUp']`, where Shift extends the selection
 * along the same axis — every `shift: false` chord in the override gets a `shift: true` twin added
 * to the parsed chords (see {@link withShiftTwins}), so rebinding the plain key preserves the
 * Shift-extend variant. The displayed `keys` stay exactly what the user specified; only `chords`
 * (used for matching) gain the twin.
 */
export function registerBinding<TScope extends string, TEvent extends KeyEventLike = KeyEventLike>(
	descriptor: KeyBindingDescriptor<TScope, TEvent>,
	isMac: boolean,
	overrides?: KeyBindingOverrides,
	onWarn?: (message: string) => void,
): KeyBinding<TScope, TEvent> | undefined {
	// Defaults are parsed first so malformed defaults still throw as before, and so an override can
	// inherit their Shift-closure.
	const defaultChords = parseKeys(descriptor.keys, `Invalid key binding for scope '${descriptor.scope}'`, isMac);

	if (descriptor.id != null) {
		const resolved = resolveOverride(descriptor.id, overrides);

		if (resolved === false) return undefined;

		if (resolved !== undefined) {
			try {
				let chords = parseKeys(resolved, `Invalid key override for id '${descriptor.id}'`, isMac);
				if (isShiftClosed(defaultChords)) {
					chords = withShiftTwins(chords);
				}

				return { ...descriptor, keys: resolved, chords: chords, overridden: true };
			} catch (ex) {
				const reason = ex instanceof Error ? ex.message : String(ex);
				onWarn?.(reason);
			}
		}
	}

	return { ...descriptor, chords: defaultChords, overridden: false };
}
