import * as assert from 'assert';
import { ensureIfBooleanOrNull } from '../actions.js';
import { integrationsCategories } from '../categories/integrations.js';
import { viewsCategories } from '../categories/views.js';
import type { SelectDescriptor } from '../model.js';

/**
 * `graph.multiselect` (`boolean | 'topological'`) and `launchpad.indicator.label`
 * (`false | 'item' | 'counts'`) are the first `select`/`segmented` descriptors
 * over a boolean|string union — this is the first live use of the
 * `ensureIfBooleanOrNull` boolean-coercion branch in `applyOption` (#5392 Doc A
 * challenge finding #9).
 */
suite('settings actions — boolean|string select round-trip', () => {
	test('ensureIfBooleanOrNull coerces the legacy select-value strings', () => {
		assert.strictEqual(ensureIfBooleanOrNull('true'), true);
		assert.strictEqual(ensureIfBooleanOrNull('false'), false);
		assert.strictEqual(ensureIfBooleanOrNull('null'), null);
		assert.strictEqual(ensureIfBooleanOrNull('topological'), 'topological');
		assert.strictEqual(ensureIfBooleanOrNull('item'), 'item');
		assert.strictEqual(ensureIfBooleanOrNull('counts'), 'counts');
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
