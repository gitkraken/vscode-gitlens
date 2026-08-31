import * as assert from 'assert';
import { resolveAgentsEmptyState } from '../agentsEmptyState.utils.js';

const connected = { installed: true };
const unconnected = { installed: false };

suite('resolveAgentsEmptyState', () => {
	test('sessions exist: nothing to explain, regardless of hooks state', () => {
		assert.strictEqual(
			resolveAgentsEmptyState({ hooksAgents: [unconnected], sessionCount: 3, bannerVisible: false }),
			undefined,
		);
		assert.strictEqual(
			resolveAgentsEmptyState({ hooksAgents: undefined, sessionCount: 1, bannerVisible: false }),
			undefined,
		);
	});

	test('hooks state not yet known: no verdict — the pitch must not flash before the first agents push', () => {
		assert.strictEqual(
			resolveAgentsEmptyState({ hooksAgents: undefined, sessionCount: 0, bannerVisible: false }),
			undefined,
		);
	});

	test('no hooks-capable agent detected at all', () => {
		assert.deepStrictEqual(resolveAgentsEmptyState({ hooksAgents: [], sessionCount: 0, bannerVisible: false }), {
			type: 'connect',
			reason: 'agents-undetected',
		});
	});

	test('agents detected but none connected', () => {
		assert.deepStrictEqual(
			resolveAgentsEmptyState({
				hooksAgents: [unconnected, unconnected],
				sessionCount: 0,
				bannerVisible: false,
			}),
			{ type: 'connect', reason: 'agents-unconnected' },
		);
	});

	test('a visible banner already carries the pitch: drop to the neutral line instead of repeating it', () => {
		assert.deepStrictEqual(
			resolveAgentsEmptyState({ hooksAgents: [unconnected], sessionCount: 0, bannerVisible: true }),
			{ type: 'no-sessions' },
		);
		assert.deepStrictEqual(resolveAgentsEmptyState({ hooksAgents: [], sessionCount: 0, bannerVisible: true }), {
			type: 'no-sessions',
		});
	});

	test('at least one agent connected: emptiness is repo-scoped, never a connect pitch', () => {
		// `canInstallHooks`-style logic would get this wrong: another agent still lacking hooks must not
		// override the fact that one is connected and working (#5777).
		assert.deepStrictEqual(
			resolveAgentsEmptyState({
				hooksAgents: [connected, unconnected],
				sessionCount: 0,
				bannerVisible: false,
			}),
			{ type: 'no-sessions' },
		);
	});
});
