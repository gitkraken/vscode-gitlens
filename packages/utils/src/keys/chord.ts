/** Structural subset of a keyboard event; lets this module stay DOM-free. */
export type KeyEventLike = {
	key: string;
	code: string;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	metaKey: boolean;
};

export type ChordModifier = 'mod' | 'ctrl' | 'alt' | 'shift' | 'meta';

/** A single parsed key combination, ready to match against key events. */
export type Chord = {
	/** The original token, e.g. `'ArrowUp'`, `'c'`, `'KeyM'`. */
	token: string;
	/** Whether the token is matched against `event.code` (layout-independent) or `event.key`. */
	matchOn: 'key' | 'code';
	ctrl: boolean;
	alt: boolean;
	meta: boolean;
	/**
	 * `true`/`false` when shift is a declared part of the chord; `'implicit'` when the token is a
	 * single printable character whose shifted form already encodes the shift state (e.g. `'?'`),
	 * so `event.shiftKey` is ignored at match time.
	 */
	shift: boolean | 'implicit';
};

const codeTokenPattern = /^(?:Key[A-Z]|Digit[0-9])$/;

const readableTokens = new Map<string, string>([
	['ArrowUp', '↑'],
	['ArrowDown', '↓'],
	['ArrowLeft', '←'],
	['ArrowRight', '→'],
	['Escape', 'Esc'],
	[' ', 'Space'],
	['PageUp', 'PgUp'],
	['PageDown', 'PgDn'],
]);

/**
 * Parses a `+`-separated key combination such as `'mod+c'` or `'alt+KeyM'` into a {@link Chord}.
 * Throws on malformed input. `isMac` resolves the `'mod'` modifier (`meta` on mac, `ctrl` otherwise).
 */
export function parseChord(input: string, isMac: boolean): Chord {
	if (!input) throw new Error(`Invalid key chord '${input}': empty input`);

	const parts = input.split('+');

	// A trailing/leading '+' (literal plus as the token) produces an empty part adjacent to a
	// non-empty one; a lone '+' would split to ['', ''] and is handled by the empty-token check below.
	if (parts.length > 1 && parts.at(-1) === '') {
		throw new Error(`Invalid key chord '${input}': trailing '+'`);
	}

	const modifiers = parts.slice(0, -1);
	const token = parts.at(-1)!;

	if (token === '') throw new Error(`Invalid key chord '${input}': empty token`);

	let mod = false;
	let ctrl = false;
	let alt = false;
	let shift = false;
	let meta = false;

	for (const modifier of modifiers) {
		switch (modifier) {
			case 'mod':
				if (mod) throw new Error(`Invalid key chord '${input}': duplicate modifier 'mod'`);

				mod = true;
				break;
			case 'ctrl':
				if (ctrl) throw new Error(`Invalid key chord '${input}': duplicate modifier 'ctrl'`);

				ctrl = true;
				break;
			case 'alt':
				if (alt) throw new Error(`Invalid key chord '${input}': duplicate modifier 'alt'`);

				alt = true;
				break;
			case 'shift':
				if (shift) throw new Error(`Invalid key chord '${input}': duplicate modifier 'shift'`);

				shift = true;
				break;
			case 'meta':
				if (meta) throw new Error(`Invalid key chord '${input}': duplicate modifier 'meta'`);

				meta = true;
				break;
			default:
				throw new Error(`Invalid key chord '${input}': unknown modifier '${modifier}'`);
		}
	}

	if (mod && ctrl) throw new Error(`Invalid key chord '${input}': 'mod' conflicts with explicit 'ctrl'`);

	if (mod && meta) throw new Error(`Invalid key chord '${input}': 'mod' conflicts with explicit 'meta'`);

	if (mod) {
		if (isMac) {
			meta = true;
		} else {
			ctrl = true;
		}
	}

	const matchOn: Chord['matchOn'] = codeTokenPattern.test(token) ? 'code' : 'key';

	let resolvedShift: Chord['shift'];
	if (matchOn === 'code') {
		resolvedShift = shift;
	} else if ([...token].length === 1) {
		if (shift) {
			throw new Error(`Invalid key chord '${input}': 'shift' cannot combine with a single-character token`);
		}

		resolvedShift = 'implicit';
	} else {
		resolvedShift = shift;
	}

	return { token: token, matchOn: matchOn, ctrl: ctrl, alt: alt, meta: meta, shift: resolvedShift };
}

/** Tests whether a key event matches a parsed chord — all declared modifiers must match exactly. */
export function matchesChord(chord: Chord, e: KeyEventLike): boolean {
	if (chord.ctrl !== e.ctrlKey) return false;
	if (chord.alt !== e.altKey) return false;
	if (chord.meta !== e.metaKey) return false;

	if (chord.shift !== 'implicit' && chord.shift !== e.shiftKey) return false;

	return chord.matchOn === 'code' ? e.code === chord.token : e.key === chord.token;
}

export type ChordSymbols = { ctrl: string; alt: string; shift: string; meta: string };

/** One display chip: a modifier (renderers style these differently) or the chord's own key. */
export type ChordPart = { text: string; kind: 'mod' | 'key' };

/**
 * Formats a chord into an ordered list of typed display chips (ctrl → alt → shift → meta → token).
 * An implicit-shift chord contributes no shift chip — its token already spells the shifted form.
 */
export function formatChordParts(chord: Chord, symbols: ChordSymbols): ChordPart[] {
	const parts: ChordPart[] = [];

	if (chord.ctrl) {
		parts.push({ text: symbols.ctrl, kind: 'mod' });
	}

	if (chord.alt) {
		parts.push({ text: symbols.alt, kind: 'mod' });
	}

	if (chord.shift === true) {
		parts.push({ text: symbols.shift, kind: 'mod' });
	}

	if (chord.meta) {
		parts.push({ text: symbols.meta, kind: 'mod' });
	}

	parts.push({ text: formatToken(chord), kind: 'key' });

	return parts;
}

/** Formats a chord into an ordered list of display chips (ctrl → alt → shift → meta → token). */
export function formatChord(chord: Chord, symbols: ChordSymbols): string[] {
	return formatChordParts(chord, symbols).map(part => part.text);
}

function formatToken(chord: Chord): string {
	if (chord.matchOn === 'code') return chord.token.replace(/^(?:Key|Digit)/, '');

	return readableTokens.get(chord.token) ?? chord.token;
}
