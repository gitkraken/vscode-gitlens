import * as assert from 'assert';
import type { ScopeSelection } from '../../../../../plus/graph/graphService.js';
import { scopeSelectionEqual } from '../detailsActions.js';

suite('scopeSelectionEqual', () => {
	test('undefined === undefined', () => {
		assert.strictEqual(scopeSelectionEqual(undefined, undefined), true);
	});

	test('defined vs undefined', () => {
		const a: ScopeSelection = { type: 'commit', sha: 'abc' };
		assert.strictEqual(scopeSelectionEqual(a, undefined), false);
		assert.strictEqual(scopeSelectionEqual(undefined, a), false);
	});

	test('same reference', () => {
		const a: ScopeSelection = { type: 'commit', sha: 'abc' };
		assert.strictEqual(scopeSelectionEqual(a, a), true);
	});

	test('commit: same sha, different objects', () => {
		assert.strictEqual(scopeSelectionEqual({ type: 'commit', sha: 'abc' }, { type: 'commit', sha: 'abc' }), true);
	});

	test('commit: different shas', () => {
		assert.strictEqual(scopeSelectionEqual({ type: 'commit', sha: 'abc' }, { type: 'commit', sha: 'def' }), false);
	});

	test('wip: all fields equal', () => {
		const a: ScopeSelection = {
			type: 'wip',
			includeStaged: true,
			includeUnstaged: false,
			includeShas: ['s1', 's2'],
		};
		const b: ScopeSelection = {
			type: 'wip',
			includeStaged: true,
			includeUnstaged: false,
			includeShas: ['s1', 's2'],
		};
		assert.strictEqual(scopeSelectionEqual(a, b), true);
	});

	test('wip: different includeShas order means not equal', () => {
		const a: ScopeSelection = {
			type: 'wip',
			includeStaged: true,
			includeUnstaged: true,
			includeShas: ['s1', 's2'],
		};
		const b: ScopeSelection = {
			type: 'wip',
			includeStaged: true,
			includeUnstaged: true,
			includeShas: ['s2', 's1'],
		};
		assert.strictEqual(scopeSelectionEqual(a, b), false);
	});

	test('wip: staged flag flip', () => {
		const a: ScopeSelection = { type: 'wip', includeStaged: true, includeUnstaged: false, includeShas: [] };
		const b: ScopeSelection = { type: 'wip', includeStaged: false, includeUnstaged: false, includeShas: [] };
		assert.strictEqual(scopeSelectionEqual(a, b), false);
	});

	test('compare: same endpoints and includeShas', () => {
		const a: ScopeSelection = { type: 'compare', fromSha: 'f', toSha: 't', includeShas: ['x'] };
		const b: ScopeSelection = { type: 'compare', fromSha: 'f', toSha: 't', includeShas: ['x'] };
		assert.strictEqual(scopeSelectionEqual(a, b), true);
	});

	test('compare: includeShas undefined vs empty array is NOT equal', () => {
		// Distinct states: undefined means "no selection constraint"; [] means "explicitly empty".
		const a: ScopeSelection = { type: 'compare', fromSha: 'f', toSha: 't' };
		const b: ScopeSelection = { type: 'compare', fromSha: 'f', toSha: 't', includeShas: [] };
		assert.strictEqual(scopeSelectionEqual(a, b), false);
	});

	test('compare: both includeShas undefined', () => {
		const a: ScopeSelection = { type: 'compare', fromSha: 'f', toSha: 't' };
		const b: ScopeSelection = { type: 'compare', fromSha: 'f', toSha: 't' };
		assert.strictEqual(scopeSelectionEqual(a, b), true);
	});

	test('different types are not equal', () => {
		const a: ScopeSelection = { type: 'commit', sha: 'abc' };
		const b: ScopeSelection = { type: 'wip', includeStaged: true, includeUnstaged: true, includeShas: [] };
		assert.strictEqual(scopeSelectionEqual(a, b), false);
	});
});
