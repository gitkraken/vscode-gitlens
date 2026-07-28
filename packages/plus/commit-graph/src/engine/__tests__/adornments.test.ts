import * as assert from 'assert';
import type { RowAdornmentProvider } from '../adornments.js';
import { AdornmentRegistry, RowAdornmentInvalidateEvent } from '../adornments.js';
import type { ProcessedGraphRow } from '../types.js';

function provider(label: string): RowAdornmentProvider<string> {
	return {
		provideRowAdornment: () => ({}),
		resolveAdornment: () => label,
		describeForA11y: () => label,
	};
}

suite('engine/adornments', () => {
	test('lists providers in registration order', () => {
		const registry = new AdornmentRegistry<string>();
		const [a, b, c] = [provider('a'), provider('b'), provider('c')];
		registry.register(a);
		registry.register(b);
		registry.register(c);
		assert.deepStrictEqual([...registry.list()], [a, b, c]);
	});

	test('register returns a disposer that removes only its own provider', () => {
		const registry = new AdornmentRegistry<string>();
		const [a, b] = [provider('a'), provider('b')];
		registry.register(a);
		const disposeB = registry.register(b);
		disposeB();
		assert.deepStrictEqual([...registry.list()], [a]);
	});

	// A provider may be torn down twice (its own disposal plus the registry's) — the second call must
	// not splice out whatever now occupies index -1's neighbor.
	test('disposing twice is harmless and leaves the other providers alone', () => {
		const registry = new AdornmentRegistry<string>();
		const [a, b] = [provider('a'), provider('b')];
		const disposeA = registry.register(a);
		registry.register(b);
		disposeA();
		disposeA();
		assert.deepStrictEqual([...registry.list()], [b]);
	});

	test('the same provider registered twice needs two disposals', () => {
		const registry = new AdornmentRegistry<string>();
		const a = provider('a');
		const first = registry.register(a);
		registry.register(a);
		first();
		assert.deepStrictEqual([...registry.list()], [a]);
	});

	test('an invalidate event carries its type and copies the shas into a set', () => {
		const shas = ['aaa', 'bbb', 'aaa'];
		const e = new RowAdornmentInvalidateEvent('content', shas);
		assert.strictEqual(e.type, RowAdornmentInvalidateEvent.type);
		assert.strictEqual(e.detail.type, 'content');
		assert.deepStrictEqual(e.detail.shas, new Set(['aaa', 'bbb']));
		// A copy, not a view — a caller mutating its own collection afterwards must not change the event.
		shas.push('ccc');
		assert.strictEqual(e.detail.shas?.has('ccc'), false);
	});

	test('an invalidate event with no shas means every row', () => {
		const e = new RowAdornmentInvalidateEvent('all');
		assert.strictEqual(e.detail.type, 'all');
		assert.strictEqual(e.detail.shas, undefined);
	});

	test('a registered provider is reachable through the registry and answers for a row', () => {
		const registry = new AdornmentRegistry<string>();
		registry.register(provider('on branch main'));
		const row: ProcessedGraphRow = {
			sha: 'aaa',
			parents: [],
			kind: 'commit',
			column: 0,
			edges: {},
			edgeColumnMax: 0,
		};
		const resolved = registry.list().map(p => p.resolveAdornment(row, undefined));
		assert.deepStrictEqual(resolved, ['on branch main']);
		assert.deepStrictEqual(
			registry.list().map(p => p.describeForA11y?.(row, undefined)),
			['on branch main'],
		);
	});
});
