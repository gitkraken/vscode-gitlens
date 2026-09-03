import * as assert from 'assert';
import type { Chord, KeyEventLike } from '../chord.js';
import type { KeyBinding, KeyBindingDescriptor, KeyBindingOverrides, OverlayEntry } from '../keybinding.js';
import {
	isShiftClosed,
	registerBinding,
	resolveKeydown,
	resolveOverlayClose,
	resolveOverride,
	withShiftTwins,
} from '../keybinding.js';

type TestScope = 'row' | 'rowControl' | 'webview';

let nextId = 0;

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

function bind(
	descriptor: Partial<Omit<KeyBindingDescriptor<TestScope>, 'run' | 'sheet'>> &
		Pick<KeyBindingDescriptor<TestScope>, 'keys' | 'scope'>,
): KeyBinding<TestScope> {
	const binding = registerBinding(
		{ id: `test.binding.${nextId++}`, ...descriptor, run: () => true, sheet: 'hidden' },
		false,
	);
	assert.ok(binding, 'expected registerBinding to return a binding');

	return binding;
}

suite('Keybinding Test Suite', () => {
	suite('resolveKeydown', () => {
		test('innermost scope resolves before outer scopes', () => {
			const outer = bind({ keys: ['Enter'], scope: 'webview' });
			const inner = bind({ keys: ['Enter'], scope: 'row' });

			const result = resolveKeydown([outer, inner], ['row', 'webview'], event({ key: 'Enter' }));
			assert.deepStrictEqual(result, [inner, outer]);
		});

		test('order ascends within a scope', () => {
			const second = bind({ keys: ['Enter'], scope: 'row', order: 2 });
			const first = bind({ keys: ['Enter'], scope: 'row', order: 1 });

			const result = resolveKeydown([second, first], ['row'], event({ key: 'Enter' }));
			assert.deepStrictEqual(result, [first, second]);
		});

		test('undefined order sorts after defined order', () => {
			const noOrder = bind({ keys: ['Enter'], scope: 'row' });
			const ordered = bind({ keys: ['Enter'], scope: 'row', order: 5 });

			const result = resolveKeydown([noOrder, ordered], ['row'], event({ key: 'Enter' }));
			assert.deepStrictEqual(result, [ordered, noOrder]);
		});

		test('registration order is the tiebreak', () => {
			const a = bind({ keys: ['Enter'], scope: 'row' });
			const b = bind({ keys: ['Enter'], scope: 'row' });

			const result = resolveKeydown([a, b], ['row'], event({ key: 'Enter' }));
			assert.deepStrictEqual(result, [a, b]);
		});

		test('a binding whose chord does not match is excluded', () => {
			const matching = bind({ keys: ['Enter'], scope: 'row' });
			const nonMatching = bind({ keys: ['Escape'], scope: 'row' });

			const result = resolveKeydown([matching, nonMatching], ['row'], event({ key: 'Enter' }));
			assert.deepStrictEqual(result, [matching]);
		});

		test('multi-key bindings match on either key', () => {
			const binding = bind({ keys: ['ArrowDown', 'j'], scope: 'row' });

			assert.deepStrictEqual(resolveKeydown([binding], ['row'], event({ key: 'ArrowDown' })), [binding]);
			assert.deepStrictEqual(resolveKeydown([binding], ['row'], event({ key: 'j' })), [binding]);
			assert.deepStrictEqual(resolveKeydown([binding], ['row'], event({ key: 'k' })), []);
		});

		test('scopes not in the chain are excluded', () => {
			const binding = bind({ keys: ['Enter'], scope: 'rowControl' });

			const result = resolveKeydown([binding], ['row', 'webview'], event({ key: 'Enter' }));
			assert.deepStrictEqual(result, []);
		});

		test('chain scopes with no bindings are skipped without error', () => {
			const binding = bind({ keys: ['Enter'], scope: 'webview' });

			const result = resolveKeydown([binding], ['row', 'rowControl', 'webview'], event({ key: 'Enter' }));
			assert.deepStrictEqual(result, [binding]);
		});
	});

	suite('resolveOverlayClose', () => {
		test('returns entries top of stack first (LIFO)', () => {
			const a: OverlayEntry = { id: 'a', onClose: () => true };
			const b: OverlayEntry = { id: 'b', onClose: () => true };
			const c: OverlayEntry = { id: 'c', onClose: () => true };

			assert.deepStrictEqual(resolveOverlayClose([a, b, c]), [c, b, a]);
		});

		test('empty stack returns empty', () => {
			assert.deepStrictEqual(resolveOverlayClose([]), []);
		});
	});

	suite('registerBinding', () => {
		test('parses all keys into chords', () => {
			const binding = registerBinding<TestScope>(
				{ id: 'rows.stepNext', keys: ['ArrowDown', 'j'], scope: 'row', run: () => true, sheet: 'hidden' },
				false,
			);

			assert.ok(binding);
			assert.strictEqual(binding.chords.length, 2);
			assert.strictEqual(binding.chords[0].token, 'ArrowDown');
			assert.strictEqual(binding.chords[1].token, 'j');
			assert.strictEqual(binding.overridden, false);
		});

		test('throws on the first malformed key, naming scope and key', () => {
			assert.throws(
				() =>
					registerBinding<TestScope>(
						{
							id: 'rows.stepNext',
							keys: ['ArrowDown', 'bogus+j'],
							scope: 'row',
							run: () => true,
							sheet: 'hidden',
						},
						false,
					),
				/scope 'row'.*key 'bogus\+j'/,
			);
		});

		test('no overrides behaves exactly as before', () => {
			const binding = registerBinding<TestScope>(
				{ id: 'rows.stepNext', keys: ['ArrowDown'], scope: 'row', run: () => true, sheet: 'hidden' },
				false,
				undefined,
			);

			assert.ok(binding);
			assert.strictEqual(binding.overridden, false);
			assert.deepStrictEqual(binding.keys, ['ArrowDown']);
		});

		test('an exact override replaces the keys and sets overridden', () => {
			const overrides: KeyBindingOverrides = { 'rows.stepNext': ['mod+j'] };
			const binding = registerBinding<TestScope>(
				{ id: 'rows.stepNext', keys: ['ArrowDown'], scope: 'row', run: () => true, sheet: 'hidden' },
				false,
				overrides,
			);

			assert.ok(binding);
			assert.strictEqual(binding.overridden, true);
			assert.deepStrictEqual(binding.keys, ['mod+j']);
			assert.strictEqual(binding.chords[0].token, 'j');
		});

		test('an override of false disables the binding', () => {
			const overrides: KeyBindingOverrides = { 'rows.stepNext': false };
			const binding = registerBinding<TestScope>(
				{ id: 'rows.stepNext', keys: ['ArrowDown'], scope: 'row', run: () => true, sheet: 'hidden' },
				false,
				overrides,
			);

			assert.strictEqual(binding, undefined);
		});

		test('an override of an empty array disables the binding', () => {
			const overrides: KeyBindingOverrides = { 'rows.stepNext': [] };
			const binding = registerBinding<TestScope>(
				{ id: 'rows.stepNext', keys: ['ArrowDown'], scope: 'row', run: () => true, sheet: 'hidden' },
				false,
				overrides,
			);

			assert.strictEqual(binding, undefined);
		});

		test('a malformed override warns, then falls back to the defaults', () => {
			const overrides: KeyBindingOverrides = { 'rows.stepNext': ['bogus+j'] };
			const warnings: string[] = [];
			const binding = registerBinding<TestScope>(
				{ id: 'rows.stepNext', keys: ['ArrowDown'], scope: 'row', run: () => true, sheet: 'hidden' },
				false,
				overrides,
				message => warnings.push(message),
			);

			assert.ok(binding);
			assert.strictEqual(binding.overridden, false);
			assert.deepStrictEqual(binding.keys, ['ArrowDown']);
			assert.strictEqual(warnings.length, 1);
			assert.match(warnings[0], /rows\.stepNext/);
			assert.match(warnings[0], /bogus\+j/);
		});

		test('malformed default keys still throw when no override applies', () => {
			assert.throws(
				() =>
					registerBinding<TestScope>(
						{
							id: 'rows.stepNext',
							keys: ['bogus+j'],
							scope: 'row',
							run: () => true,
							sheet: 'hidden',
						},
						false,
						{ 'other.id': ['mod+k'] },
					),
				/scope 'row'.*key 'bogus\+j'/,
			);
		});

		test('a binding without an id ignores overrides, including a wildcard `false`', () => {
			const overrides: KeyBindingOverrides = { '*': false, 'rows.stepNext': ['mod+j'] };
			const binding = registerBinding<TestScope>(
				{ keys: ['ArrowDown'], scope: 'row', run: () => true, sheet: 'hidden' },
				false,
				overrides,
			);

			assert.ok(binding);
			assert.strictEqual(binding.overridden, false);
			assert.deepStrictEqual(binding.keys, ['ArrowDown']);
		});

		test('a wildcard override with a non-empty key list is ignored, keeping the default keys', () => {
			const overrides: KeyBindingOverrides = { '*': ['mod+j'] };
			const binding = registerBinding<TestScope>(
				{ id: 'rows.stepNext', keys: ['ArrowDown'], scope: 'row', run: () => true, sheet: 'hidden' },
				false,
				overrides,
			);

			assert.ok(binding);
			assert.strictEqual(binding.overridden, false);
			assert.deepStrictEqual(binding.keys, ['ArrowDown']);
		});

		test('an exact id override still rebinds even when a same-prefix wildcard carries keys', () => {
			const overrides: KeyBindingOverrides = { 'rows.*': ['mod+j'], 'rows.stepNext': ['mod+k'] };
			const binding = registerBinding<TestScope>(
				{ id: 'rows.stepNext', keys: ['ArrowDown'], scope: 'row', run: () => true, sheet: 'hidden' },
				false,
				overrides,
			);

			assert.ok(binding);
			assert.strictEqual(binding.overridden, true);
			assert.deepStrictEqual(binding.keys, ['mod+k']);
		});

		test('an override on a Shift-closed default gets Shift twins added to its chords', () => {
			// A code-token override (`KeyJ`), not a bare letter — a bare letter's shift is 'implicit'
			// (its shifted form already encodes the shift state), so it would never be `shift: false`
			// and never get a twin; see `parseChord`.
			const overrides: KeyBindingOverrides = { 'rows.stepNext': ['mod+KeyJ'] };
			const binding = registerBinding<TestScope>(
				{
					id: 'rows.stepNext',
					keys: ['ArrowDown', 'shift+ArrowDown'],
					scope: 'row',
					run: () => true,
					sheet: 'hidden',
				},
				false,
				overrides,
			);

			assert.ok(binding);
			// The displayed keys are exactly what the user typed — no twin spelled out there.
			assert.deepStrictEqual(binding.keys, ['mod+KeyJ']);
			assert.strictEqual(binding.chords.length, 2);
			assert.strictEqual(binding.chords[0].shift, false);
			assert.strictEqual(binding.chords[1].token, 'KeyJ');
			assert.strictEqual(binding.chords[1].shift, true);
		});

		test('an override on a non-Shift-closed default does not get Shift twins', () => {
			const overrides: KeyBindingOverrides = { 'rows.stepNext': ['mod+j'] };
			const binding = registerBinding<TestScope>(
				{ id: 'rows.stepNext', keys: ['ArrowDown'], scope: 'row', run: () => true, sheet: 'hidden' },
				false,
				overrides,
			);

			assert.ok(binding);
			assert.strictEqual(binding.chords.length, 1);
		});
	});

	suite('isShiftClosed', () => {
		function chord(overrides: Partial<Chord> = {}): Chord {
			return {
				token: 'ArrowUp',
				matchOn: 'key',
				ctrl: false,
				alt: false,
				meta: false,
				shift: false,
				...overrides,
			};
		}

		test('true when every shift:false chord has a shift:true twin', () => {
			assert.strictEqual(isShiftClosed([chord(), chord({ shift: true })]), true);
		});

		test('false when a shift:false chord has no twin', () => {
			assert.strictEqual(isShiftClosed([chord()]), false);
		});

		test('implicit-shift chords are ignored, not required to have a twin', () => {
			assert.strictEqual(isShiftClosed([chord({ token: '?', shift: 'implicit' })]), true);
		});

		test('a mix of a closed pair and an ignored implicit chord is still closed', () => {
			assert.strictEqual(
				isShiftClosed([chord(), chord({ shift: true }), chord({ token: '?', shift: 'implicit' })]),
				true,
			);
		});

		test('an unrelated shift:true chord does not create a false twin match', () => {
			assert.strictEqual(
				isShiftClosed([chord({ token: 'ArrowDown' }), chord({ token: 'ArrowUp', shift: true })]),
				false,
			);
		});
	});

	suite('withShiftTwins', () => {
		function chord(overrides: Partial<Chord> = {}): Chord {
			return { token: 'j', matchOn: 'key', ctrl: false, alt: false, meta: false, shift: false, ...overrides };
		}

		test('appends a shift:true twin right after each shift:false chord', () => {
			const result = withShiftTwins([chord()]);
			assert.strictEqual(result.length, 2);
			assert.strictEqual(result[0].shift, false);
			assert.strictEqual(result[1].shift, true);
			assert.strictEqual(result[1].token, 'j');
		});

		test('leaves shift:true chords unchanged, with no twin added', () => {
			const result = withShiftTwins([chord({ shift: true })]);
			assert.deepStrictEqual(result, [chord({ shift: true })]);
		});

		test('leaves implicit-shift chords unchanged, with no twin added', () => {
			const result = withShiftTwins([chord({ token: '?', shift: 'implicit' })]);
			assert.deepStrictEqual(result, [chord({ token: '?', shift: 'implicit' })]);
		});
	});

	suite('resolveOverride', () => {
		test('returns undefined when overrides is undefined', () => {
			assert.strictEqual(resolveOverride('rows.stepNext', undefined), undefined);
		});

		test('returns undefined when nothing matches', () => {
			const overrides: KeyBindingOverrides = { 'other.id': ['mod+k'] };
			assert.strictEqual(resolveOverride('rows.stepNext', overrides), undefined);
		});

		test('an exact id match returns its replacement keys', () => {
			const overrides: KeyBindingOverrides = { 'rows.stepNext': ['mod+j'] };
			assert.deepStrictEqual(resolveOverride('rows.stepNext', overrides), ['mod+j']);
		});

		test('an exact id match of false returns false', () => {
			const overrides: KeyBindingOverrides = { 'rows.stepNext': false };
			assert.strictEqual(resolveOverride('rows.stepNext', overrides), false);
		});

		test('an empty array is normalized to false', () => {
			const overrides: KeyBindingOverrides = { 'rows.stepNext': [] };
			assert.strictEqual(resolveOverride('rows.stepNext', overrides), false);
		});

		test('a prefix wildcard can disable ids under that prefix', () => {
			const overrides: KeyBindingOverrides = { 'rows.*': false };
			assert.strictEqual(resolveOverride('rows.stepNext', overrides), false);
			assert.strictEqual(resolveOverride('panels.toggle', overrides), undefined);
		});

		test("bare '*' matches every id", () => {
			const overrides: KeyBindingOverrides = { '*': false };
			assert.strictEqual(resolveOverride('rows.stepNext', overrides), false);
			assert.strictEqual(resolveOverride('panels.toggle', overrides), false);
		});

		test('an exact id match wins over any wildcard', () => {
			const overrides: KeyBindingOverrides = {
				'*': false,
				'rows.*': false,
				'rows.stepNext': ['mod+j'],
			};
			assert.deepStrictEqual(resolveOverride('rows.stepNext', overrides), ['mod+j']);
		});

		test('a longer wildcard wins over a shorter wildcard', () => {
			const overrides: KeyBindingOverrides = {
				'*': false,
				'rows.*': false,
				'rows.step.*': false,
			};
			assert.strictEqual(resolveOverride('rows.step.next', overrides), false);
			assert.strictEqual(resolveOverride('rows.other', overrides), false);
			assert.strictEqual(resolveOverride('panels.toggle', overrides), false);
		});

		test('a wildcard with a non-empty key list is ignored — not a rebind candidate', () => {
			const overrides: KeyBindingOverrides = { 'rows.*': ['mod+j'] };
			assert.strictEqual(resolveOverride('rows.stepNext', overrides), undefined);
		});

		test('an ignored wildcard falls through to another, still-matching wildcard', () => {
			const overrides: KeyBindingOverrides = { 'rows.*': ['mod+j'], '*': false };
			assert.strictEqual(resolveOverride('rows.stepNext', overrides), false);
		});

		test('an ignored wildcard falls through to undefined when nothing else matches', () => {
			const overrides: KeyBindingOverrides = { 'rows.*': ['mod+j'] };
			assert.strictEqual(resolveOverride('rows.other', overrides), undefined);
			assert.strictEqual(resolveOverride('panels.toggle', overrides), undefined);
		});

		test('an exact id with a key list still works even under a same-prefix ignored wildcard', () => {
			const overrides: KeyBindingOverrides = { 'rows.*': ['mod+j'], 'rows.stepNext': ['mod+k'] };
			assert.deepStrictEqual(resolveOverride('rows.stepNext', overrides), ['mod+k']);
		});
	});
});
