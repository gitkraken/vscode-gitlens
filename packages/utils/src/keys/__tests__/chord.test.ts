import * as assert from 'assert';
import type { Chord, KeyEventLike } from '../chord.js';
import { formatChord, formatChordParts, matchesChord, parseChord } from '../chord.js';

function event(overrides: Partial<KeyEventLike> = {}): KeyEventLike {
	return {
		key: 'a',
		code: 'KeyA',
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		metaKey: false,
		...overrides,
	};
}

const symbols = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Cmd' };

suite('Chord Test Suite', () => {
	suite('parseChord', () => {
		test('parses a bare named key', () => {
			const chord = parseChord('ArrowLeft', false);
			assert.strictEqual(chord.token, 'ArrowLeft');
			assert.strictEqual(chord.matchOn, 'key');
			assert.strictEqual(chord.ctrl, false);
			assert.strictEqual(chord.alt, false);
			assert.strictEqual(chord.meta, false);
			assert.strictEqual(chord.shift, false);
		});

		test('resolves mod to meta on mac', () => {
			const chord = parseChord('mod+c', true);
			assert.strictEqual(chord.meta, true);
			assert.strictEqual(chord.ctrl, false);
		});

		test('resolves mod to ctrl off mac', () => {
			const chord = parseChord('mod+c', false);
			assert.strictEqual(chord.ctrl, true);
			assert.strictEqual(chord.meta, false);
		});

		test('mod combined with explicit ctrl throws', () => {
			assert.throws(() => parseChord('mod+ctrl+c', false), /mod\+ctrl\+c/);
		});

		test('mod combined with explicit meta throws', () => {
			assert.throws(() => parseChord('mod+meta+c', true), /mod\+meta\+c/);
		});

		test('code tokens: KeyX matches Key[A-Z], DigitN matches Digit[0-9]', () => {
			assert.strictEqual(parseChord('alt+KeyM', false).matchOn, 'code');
			assert.strictEqual(parseChord('ctrl+alt+Digit3', false).matchOn, 'code');
		});

		test('single-character tokens get implicit shift', () => {
			assert.strictEqual(parseChord('?', false).shift, 'implicit');
			assert.strictEqual(parseChord('[', false).shift, 'implicit');
			assert.strictEqual(parseChord('h', false).shift, 'implicit');
			assert.strictEqual(parseChord('H', false).shift, 'implicit');
			assert.strictEqual(parseChord('/', false).shift, 'implicit');
			assert.strictEqual(parseChord(' ', false).shift, 'implicit');
		});

		test('named multi-char keys default shift to false', () => {
			assert.strictEqual(parseChord('ArrowLeft', false).shift, false);
			assert.strictEqual(parseChord('Home', false).shift, false);
			assert.strictEqual(parseChord('F3', false).shift, false);
			assert.strictEqual(parseChord('Tab', false).shift, false);
			assert.strictEqual(parseChord('Escape', false).shift, false);
			assert.strictEqual(parseChord('Enter', false).shift, false);
		});

		test('code tokens default shift to false', () => {
			assert.strictEqual(parseChord('KeyM', false).shift, false);
			assert.strictEqual(parseChord('Digit3', false).shift, false);
		});

		test('explicit shift on a named key', () => {
			assert.strictEqual(parseChord('shift+ArrowLeft', false).shift, true);
		});

		test('explicit shift on a single-character token throws', () => {
			assert.throws(() => parseChord('shift+?', false), /shift\+\?/);
		});

		test('space as a literal token', () => {
			const chord = parseChord(' ', false);
			assert.strictEqual(chord.token, ' ');
			assert.strictEqual(chord.matchOn, 'key');
		});

		test('named keys are exact-case', () => {
			assert.strictEqual(parseChord('ArrowLeft', false).token, 'ArrowLeft');
		});

		test('empty input throws', () => {
			assert.throws(() => parseChord('', false), /empty input/);
		});

		test('trailing + throws', () => {
			assert.throws(() => parseChord('ctrl+', false), /trailing/);
		});

		test('duplicate modifier throws', () => {
			assert.throws(() => parseChord('ctrl+ctrl+c', false), /duplicate modifier 'ctrl'/);
		});

		test('unknown modifier throws', () => {
			assert.throws(() => parseChord('foo+c', false), /unknown modifier 'foo'/);
		});

		test('thrown messages name the bad input', () => {
			assert.throws(() => parseChord('bogus+c', false), /bogus\+c/);
		});
	});

	suite('matchesChord', () => {
		test('ArrowLeft does not match with any single modifier held', () => {
			const chord = parseChord('ArrowLeft', false);
			assert.strictEqual(matchesChord(chord, event({ key: 'ArrowLeft', altKey: true })), false);
			assert.strictEqual(matchesChord(chord, event({ key: 'ArrowLeft', ctrlKey: true })), false);
			assert.strictEqual(matchesChord(chord, event({ key: 'ArrowLeft', metaKey: true })), false);
			assert.strictEqual(matchesChord(chord, event({ key: 'ArrowLeft', shiftKey: true })), false);
		});

		test('ArrowLeft matches with no modifiers held', () => {
			const chord = parseChord('ArrowLeft', false);
			assert.strictEqual(matchesChord(chord, event({ key: 'ArrowLeft' })), true);
		});

		test('alt+ArrowLeft matches only alt', () => {
			const chord = parseChord('alt+ArrowLeft', false);
			assert.strictEqual(matchesChord(chord, event({ key: 'ArrowLeft', altKey: true })), true);
			assert.strictEqual(matchesChord(chord, event({ key: 'ArrowLeft', altKey: true, shiftKey: true })), false);
			assert.strictEqual(matchesChord(chord, event({ key: 'ArrowLeft', altKey: true, ctrlKey: true })), false);
		});

		test('code token matches by code regardless of key', () => {
			const chord = parseChord('alt+KeyM', false);
			assert.strictEqual(matchesChord(chord, event({ code: 'KeyM', key: 'µ', altKey: true })), true);
			assert.strictEqual(matchesChord(chord, event({ code: 'KeyM', key: 'ß', altKey: true })), true);
		});

		test('Digit3 does not match Numpad3', () => {
			const chord = parseChord('Digit3', false);
			assert.strictEqual(matchesChord(chord, event({ code: 'Numpad3', key: '3' })), false);
		});

		test('code tokens reject shiftKey held', () => {
			const chord = parseChord('KeyM', false);
			assert.strictEqual(matchesChord(chord, event({ code: 'KeyM', shiftKey: true })), false);
		});

		test('implicit shift: ? matches with and without shiftKey', () => {
			const chord = parseChord('?', false);
			assert.strictEqual(matchesChord(chord, event({ key: '?' })), true);
			assert.strictEqual(matchesChord(chord, event({ key: '?', shiftKey: true })), true);
		});

		test('implicit shift: [ matches with and without shiftKey', () => {
			const chord = parseChord('[', false);
			assert.strictEqual(matchesChord(chord, event({ key: '[' })), true);
			assert.strictEqual(matchesChord(chord, event({ key: '[', shiftKey: true })), true);
		});

		test('H and h are distinct keys', () => {
			const upper = parseChord('H', false);
			const lower = parseChord('h', false);
			assert.strictEqual(matchesChord(upper, event({ key: 'h' })), false);
			assert.strictEqual(matchesChord(lower, event({ key: 'H' })), false);
			assert.strictEqual(matchesChord(upper, event({ key: 'H' })), true);
			assert.strictEqual(matchesChord(lower, event({ key: 'h' })), true);
		});

		test('space token matches the Space key', () => {
			const chord = parseChord(' ', false);
			assert.strictEqual(matchesChord(chord, event({ key: ' ' })), true);
		});
	});

	suite('formatChord', () => {
		test('chip order is ctrl, alt, shift, meta, token', () => {
			const chord: Chord = { token: 'c', matchOn: 'key', ctrl: true, alt: true, meta: true, shift: true };
			assert.deepStrictEqual(formatChord(chord, symbols), ['Ctrl', 'Alt', 'Shift', 'Cmd', 'c']);
		});

		test('code-token rendering strips Key/Digit prefix', () => {
			assert.deepStrictEqual(formatChord(parseChord('alt+KeyM', false), symbols), ['Alt', 'M']);
			assert.deepStrictEqual(formatChord(parseChord('Digit3', false), symbols), ['3']);
		});

		test('readable map for named keys', () => {
			assert.deepStrictEqual(formatChord(parseChord('ArrowUp', false), symbols), ['↑']);
			assert.deepStrictEqual(formatChord(parseChord('ArrowDown', false), symbols), ['↓']);
			assert.deepStrictEqual(formatChord(parseChord('ArrowLeft', false), symbols), ['←']);
			assert.deepStrictEqual(formatChord(parseChord('ArrowRight', false), symbols), ['→']);
			assert.deepStrictEqual(formatChord(parseChord('Escape', false), symbols), ['Esc']);
			assert.deepStrictEqual(formatChord(parseChord(' ', false), symbols), ['Space']);
			assert.deepStrictEqual(formatChord(parseChord('PageUp', false), symbols), ['PgUp']);
			assert.deepStrictEqual(formatChord(parseChord('PageDown', false), symbols), ['PgDn']);
		});

		test('named keys without a readable-map entry render as-is', () => {
			assert.deepStrictEqual(formatChord(parseChord('Tab', false), symbols), ['Tab']);
		});

		test('implicit shift renders no shift chip', () => {
			assert.deepStrictEqual(formatChord(parseChord('?', false), symbols), ['?']);
		});
	});

	suite('formatChordParts', () => {
		test('modifiers are marked as mod, the token as key', () => {
			const chord: Chord = { token: 'c', matchOn: 'key', ctrl: true, alt: true, meta: true, shift: true };
			assert.deepStrictEqual(formatChordParts(chord, symbols), [
				{ text: 'Ctrl', kind: 'mod' },
				{ text: 'Alt', kind: 'mod' },
				{ text: 'Shift', kind: 'mod' },
				{ text: 'Cmd', kind: 'mod' },
				{ text: 'c', kind: 'key' },
			]);
		});

		test('implicit shift contributes no mod part', () => {
			assert.deepStrictEqual(formatChordParts(parseChord('?', false), symbols), [{ text: '?', kind: 'key' }]);
		});

		test('code tokens render stripped, as a key part', () => {
			assert.deepStrictEqual(formatChordParts(parseChord('shift+KeyH', false), symbols), [
				{ text: 'Shift', kind: 'mod' },
				{ text: 'H', kind: 'key' },
			]);
			assert.deepStrictEqual(formatChordParts(parseChord('shift+Digit8', false), symbols), [
				{ text: 'Shift', kind: 'mod' },
				{ text: '8', kind: 'key' },
			]);
		});

		test('mod resolves per platform and stays a mod part', () => {
			assert.deepStrictEqual(formatChordParts(parseChord('mod+KeyC', true), symbols), [
				{ text: 'Cmd', kind: 'mod' },
				{ text: 'C', kind: 'key' },
			]);
			assert.deepStrictEqual(formatChordParts(parseChord('mod+KeyC', false), symbols), [
				{ text: 'Ctrl', kind: 'mod' },
				{ text: 'C', kind: 'key' },
			]);
		});

		test('formatChord is the parts, flattened', () => {
			const chord = parseChord('ctrl+alt+ArrowUp', false);
			assert.deepStrictEqual(
				formatChord(chord, symbols),
				formatChordParts(chord, symbols).map(part => part.text),
			);
		});
	});

	suite('exhaustiveness', () => {
		const samples: { input: string; isMac: boolean }[] = [
			{ input: 'ArrowLeft', isMac: false },
			{ input: 'alt+ArrowLeft', isMac: false },
			{ input: 'shift+ArrowLeft', isMac: false },
			{ input: 'ctrl+alt+ArrowLeft', isMac: false },
			{ input: 'mod+c', isMac: false },
			{ input: 'mod+c', isMac: true },
			{ input: 'alt+KeyM', isMac: false },
			{ input: 'Digit3', isMac: false },
			{ input: '?', isMac: false },
			{ input: '[', isMac: false },
			{ input: 'h', isMac: false },
			{ input: 'H', isMac: false },
		];

		test('every sample chord matches exactly its declared modifier combination', () => {
			for (const { input, isMac } of samples) {
				const chord = parseChord(input, isMac);

				for (let mask = 0; mask < 16; mask++) {
					const ctrlKey = (mask & 1) !== 0;
					const altKey = (mask & 2) !== 0;
					const shiftKey = (mask & 4) !== 0;
					const metaKey = (mask & 8) !== 0;

					const key = chord.matchOn === 'key' ? chord.token : 'x';
					const code = chord.matchOn === 'code' ? chord.token : 'Unused';

					const expected =
						chord.ctrl === ctrlKey &&
						chord.alt === altKey &&
						chord.meta === metaKey &&
						(chord.shift === 'implicit' || chord.shift === shiftKey);

					const actual = matchesChord(
						chord,
						event({
							key: key,
							code: code,
							ctrlKey: ctrlKey,
							altKey: altKey,
							shiftKey: shiftKey,
							metaKey: metaKey,
						}),
					);

					assert.strictEqual(
						actual,
						expected,
						`chord '${input}' (isMac=${isMac}) vs mask ctrl=${ctrlKey} alt=${altKey} shift=${shiftKey} meta=${metaKey}`,
					);
				}
			}
		});
	});
});
