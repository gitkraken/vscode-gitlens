import * as assert from 'assert';
import type { KeyEventLike } from '../chord.js';
import type { KeyBinding, KeyBindingDescriptor, OverlayEntry } from '../keybinding.js';
import { registerBinding, resolveKeydown, resolveOverlayClose } from '../keybinding.js';

type TestScope = 'row' | 'rowControl' | 'webview';

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

function bind(descriptor: Omit<KeyBindingDescriptor<TestScope>, 'run' | 'sheet'>): KeyBinding<TestScope> {
	return registerBinding({ ...descriptor, run: () => true, sheet: 'hidden' }, false);
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
				{ keys: ['ArrowDown', 'j'], scope: 'row', run: () => true, sheet: 'hidden' },
				false,
			);

			assert.strictEqual(binding.chords.length, 2);
			assert.strictEqual(binding.chords[0].token, 'ArrowDown');
			assert.strictEqual(binding.chords[1].token, 'j');
		});

		test('throws on the first malformed key, naming scope and key', () => {
			assert.throws(
				() =>
					registerBinding<TestScope>(
						{ keys: ['ArrowDown', 'bogus+j'], scope: 'row', run: () => true, sheet: 'hidden' },
						false,
					),
				/scope 'row'.*key 'bogus\+j'/,
			);
		});
	});
});
