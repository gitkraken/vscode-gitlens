import * as assert from 'assert';
import { applyGraphSelectionChange } from '../selection.js';

suite('applyGraphSelectionChange', () => {
	test('replace selects only the changed sha', () => {
		assert.deepStrictEqual(applyGraphSelectionChange({ a: true, b: true }, { sha: 'c', mode: 'replace' }), {
			c: true,
		});
	});

	test('range selects the range shas in their order', () => {
		const next = applyGraphSelectionChange({ a: true }, { sha: 'd', mode: 'range', rangeShas: ['b', 'c', 'd'] });
		assert.deepStrictEqual(Object.keys(next), ['b', 'c', 'd']);
	});

	test('range with no range shas falls back to the changed sha', () => {
		assert.deepStrictEqual(applyGraphSelectionChange({ a: true }, { sha: 'b', mode: 'range', rangeShas: [] }), {
			b: true,
		});
	});

	test('toggle appends an unselected sha and removes a selected one, keeping the rest in order', () => {
		const added = applyGraphSelectionChange({ a: true, b: true }, { sha: 'c', mode: 'toggle' });
		assert.deepStrictEqual(Object.keys(added), ['a', 'b', 'c']);
		const removed = applyGraphSelectionChange(added, { sha: 'a', mode: 'toggle' });
		assert.deepStrictEqual(Object.keys(removed), ['b', 'c']);
	});

	test('toggling off the only selected sha keeps it selected', () => {
		assert.deepStrictEqual(applyGraphSelectionChange({ a: true }, { sha: 'a', mode: 'toggle' }), { a: true });
	});
});
