import * as assert from 'node:assert';
import { parseAgents } from '../agentFetcher.js';

/** Minimal well-formed raw agent record — every required field the CLI's `agents list --json` emits. */
function rawAgent(overrides?: Record<string, unknown>): Record<string, unknown> {
	return {
		name: 'claude-cli',
		displayName: 'Claude Code',
		detected: true,
		executable: '/usr/bin/claude',
		mcpSupported: true,
		mcpInstalled: false,
		hooksSupported: true,
		hooksInstalled: false,
		type: 'cli',
		...overrides,
	};
}

suite('parseAgents', () => {
	test('drops an item missing `type`', () => {
		const { type: _type, ...withoutType } = rawAgent();
		const agents = parseAgents(JSON.stringify([withoutType]));
		assert.deepStrictEqual(agents, []);
	});

	test('keeps an item with an unrecognized `type` string, normalized to "unknown"', () => {
		const agents = parseAgents(JSON.stringify([rawAgent({ type: 'some-future-type' })]));
		assert.strictEqual(agents.length, 1);
		assert.strictEqual(agents[0].type, 'unknown');
	});

	test('round-trips a well-formed item', () => {
		const agents = parseAgents(JSON.stringify([rawAgent()]));
		assert.deepStrictEqual(agents, [
			{
				name: 'claude-cli',
				displayName: 'Claude Code',
				detected: true,
				executable: '/usr/bin/claude',
				mcpSupported: true,
				mcpInstalled: false,
				hooksSupported: true,
				hooksInstalled: false,
				type: 'cli',
			},
		]);
	});
});
