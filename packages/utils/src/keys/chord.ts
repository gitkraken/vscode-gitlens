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
	/** The canonical token spelling, e.g. `'ArrowUp'`, `'c'`, `'KeyM'`. */
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
const keyTokenPattern = /^key([a-z])$/i;
const digitTokenPattern = /^digit([0-9])$/i;

/**
 * Thrown by {@link parseChord} for malformed input. `message` is the full diagnostic; `reason` is a
 * short phrase that reads after the quoted input (`'<input>' <reason>`) for user-facing reports.
 */
export class ChordParseError extends Error {
	constructor(
		readonly input: string,
		readonly reason: string,
		detail: string,
	) {
		super(`Invalid key chord '${input}': ${detail}`);
		this.name = 'ChordParseError';
	}
}

/**
 * Multi-character `KeyboardEvent.key` values a chord token may name (anything else could never match),
 * keyed by lowercased name so lookups are case-insensitive and resolve to the canonical spelling.
 */
const namedKeyTokens = new Map<string, string>(
	[
		'ArrowUp',
		'ArrowDown',
		'ArrowLeft',
		'ArrowRight',
		'Backspace',
		'BrowserBack',
		'BrowserForward',
		'Clear',
		'ContextMenu',
		'Delete',
		'End',
		'Enter',
		'Escape',
		'Help',
		'Home',
		'Insert',
		'PageDown',
		'PageUp',
		'Pause',
		'ScrollLock',
		'Tab',
		...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
	].map(name => [name.toLowerCase(), name]),
);

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
 * Modifier and multi-character key names are case-insensitive (`'Alt+keym'` is `'alt+KeyM'`); a
 * single-character token is matched exactly. Throws on malformed input. `isMac` resolves the `'mod'`
 * modifier (`meta` on mac, `ctrl` otherwise).
 */
export function parseChord(input: string, isMac: boolean): Chord {
	if (!input) throw new ChordParseError(input, 'is empty', 'empty input');

	const parts = input.split('+');

	// A literal '+' can't be a token: it splits to an empty last part, so a lone '+' and 'ctrl++' are
	// both rejected here as a trailing '+'.
	if (parts.length > 1 && parts.at(-1) === '') {
		throw new ChordParseError(input, "ends with '+' (a literal '+' can't be bound)", "trailing '+'");
	}

	const modifiers = parts.slice(0, -1);
	const rawToken = parts.at(-1)!;

	if (rawToken === '') throw new ChordParseError(input, 'has no key', 'empty token');

	let mod = false;
	let ctrl = false;
	let alt = false;
	let shift = false;
	let meta = false;

	for (const modifier of modifiers) {
		switch (modifier.toLowerCase()) {
			case 'mod':
				if (mod) throw new ChordParseError(input, `repeats the modifier 'mod'`, "duplicate modifier 'mod'");

				mod = true;
				break;
			case 'ctrl':
				if (ctrl) throw new ChordParseError(input, `repeats the modifier 'ctrl'`, "duplicate modifier 'ctrl'");

				ctrl = true;
				break;
			case 'alt':
				if (alt) throw new ChordParseError(input, `repeats the modifier 'alt'`, "duplicate modifier 'alt'");

				alt = true;
				break;
			case 'shift':
				if (shift) {
					throw new ChordParseError(input, `repeats the modifier 'shift'`, "duplicate modifier 'shift'");
				}

				shift = true;
				break;
			case 'meta':
				if (meta) throw new ChordParseError(input, `repeats the modifier 'meta'`, "duplicate modifier 'meta'");

				meta = true;
				break;
			default:
				throw new ChordParseError(
					input,
					`has an unknown modifier '${modifier}'`,
					`unknown modifier '${modifier}'`,
				);
		}
	}

	if (mod && ctrl) {
		throw new ChordParseError(
			input,
			"combines 'mod' with 'ctrl' ('mod' already means Ctrl, or ⌘ on macOS)",
			"'mod' conflicts with explicit 'ctrl'",
		);
	}

	if (mod && meta) {
		throw new ChordParseError(
			input,
			"combines 'mod' with 'meta' ('mod' already means Ctrl, or ⌘ on macOS)",
			"'mod' conflicts with explicit 'meta'",
		);
	}

	if (mod) {
		if (isMac) {
			meta = true;
		} else {
			ctrl = true;
		}
	}

	const isSingleChar = [...rawToken].length === 1;

	// Single characters stay case-sensitive (`h` and `H` are distinct bindings); multi-character names are
	// resolved to their canonical spelling, since that is what `matchesChord` and the display compare on.
	let token = rawToken;
	if (!isSingleChar) {
		const keyMatch = keyTokenPattern.exec(rawToken);
		const digitMatch = digitTokenPattern.exec(rawToken);
		if (keyMatch != null) {
			token = `Key${keyMatch[1].toUpperCase()}`;
		} else if (digitMatch != null) {
			token = `Digit${digitMatch[1]}`;
		} else {
			const named = namedKeyTokens.get(rawToken.toLowerCase());
			if (named == null) {
				throw new ChordParseError(input, `has an unknown key '${rawToken}'`, `unknown key '${rawToken}'`);
			}

			token = named;
		}
	}

	const matchOn: Chord['matchOn'] = codeTokenPattern.test(token) ? 'code' : 'key';

	let resolvedShift: Chord['shift'];
	if (matchOn === 'code') {
		resolvedShift = shift;
	} else if (isSingleChar) {
		if (shift) {
			throw new ChordParseError(
				input,
				`combines shift with a single character (use '${rawToken}' alone)`,
				"'shift' cannot combine with a single-character token",
			);
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
