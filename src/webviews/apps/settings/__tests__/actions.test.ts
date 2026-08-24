import * as assert from 'assert';
import { coerceOptionValue } from '../actions.js';
import { integrationsCategories } from '../categories/integrations.js';
import { viewsCategories } from '../categories/views.js';
import type { SelectDescriptor } from '../model.js';

/**
 * `graph.multiselect` (`boolean | 'topological'`) and `launchpad.indicator.label`
 * (`false | 'item' | 'counts'`) are the first `select`/`segmented` descriptors
 * over a boolean|string union — this is the first live use of the
 * `coerceOptionValue` boolean-coercion branch in `applyOption` (#5392 Doc A
 * challenge finding #9).
 */
suite('settings actions — boolean|string select round-trip', () => {
	test('coerceOptionValue coerces the legacy select-value strings', () => {
		assert.strictEqual(coerceOptionValue('true'), true);
		assert.strictEqual(coerceOptionValue('false'), false);
		assert.strictEqual(coerceOptionValue('null'), null);
		assert.strictEqual(coerceOptionValue('topological'), 'topological');
		assert.strictEqual(coerceOptionValue('item'), 'item');
		assert.strictEqual(coerceOptionValue('counts'), 'counts');
	});

	test('graph.multiselect is authored as a boolean|string select with matching option values', () => {
		const commitGraph = viewsCategories.find(c => c.id === 'commit-graph');
		const descriptor = commitGraph?.controls.find(
			(c): c is SelectDescriptor => 'key' in c && c.key === 'graph.multiselect',
		);
		assert.ok(descriptor, 'graph.multiselect must be a select/segmented descriptor');
		const values = descriptor.options.map(o => o.value).sort();
		assert.deepStrictEqual(values, ['false', 'topological', 'true']);
		// Round-trip: String(currentValue) must match one of the authored option values
		assert.ok(values.includes(String(true)));
		assert.ok(values.includes(String(false)));
		assert.ok(values.includes('topological'));
	});

	test('launchpad.indicator.label is authored as a boolean|string select with matching option values', () => {
		const launchpad = integrationsCategories.find(c => c.id === 'launchpad');
		const descriptor = launchpad?.controls.find(
			(c): c is SelectDescriptor => 'key' in c && c.key === 'launchpad.indicator.label',
		);
		assert.ok(descriptor, 'launchpad.indicator.label must be a select/segmented descriptor');
		const values = descriptor.options.map(o => o.value).sort();
		assert.deepStrictEqual(values, ['counts', 'false', 'item']);
		assert.ok(values.includes(String(false)));
	});
});

/**
 * `graph.refs.maxInline` (`number | 'auto'`, default 1) and `graph.refs.maxStacked`
 * (`number | 'auto'`, default 'auto') are selects over a number|string union — a plain
 * number input couldn't display or accept 'auto' and discarded it on any interaction
 * (#5763). The numeric option values rely on `coerceOptionValue`'s number-coercion
 * branch so selecting '5' writes 5, matching the package.json enum.
 */
suite("settings actions — number|'auto' select round-trip", () => {
	test('coerceOptionValue coerces numeric option values to numbers', () => {
		assert.strictEqual(coerceOptionValue('1'), 1);
		assert.strictEqual(coerceOptionValue('10'), 10);
		assert.strictEqual(coerceOptionValue('0'), 0);
		assert.strictEqual(coerceOptionValue('auto'), 'auto');
		assert.strictEqual(coerceOptionValue(''), '');
	});

	for (const key of ['graph.refs.maxInline', 'graph.refs.maxStacked'] as const) {
		test(`${key} is authored as a number|'auto' select with matching option values`, () => {
			const commitGraph = viewsCategories.find(c => c.id === 'commit-graph');
			const descriptor = commitGraph?.controls.find((c): c is SelectDescriptor => 'key' in c && c.key === key);
			assert.ok(descriptor, `${key} must be a select descriptor`);
			assert.strictEqual(descriptor.kind, 'select');
			const values = descriptor.options.map(o => o.value);
			assert.deepStrictEqual(values, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'auto']);
			// Round-trip: String(currentValue) must match one of the authored option values
			assert.ok(values.includes(String(5)));
			assert.ok(values.includes('auto'));
		});
	}
});
