import * as assert from 'node:assert';
import type { GkAgent } from '@env/gk/agentFetcher.js';
import { AgentService } from '../agentService.js';

function agent(overrides: Partial<GkAgent> & Pick<GkAgent, 'name' | 'type'>): GkAgent {
	return {
		displayName: overrides.name,
		detected: true,
		// The running Node binary stands in for a real, on-disk executable — `getDetectedCliAgents`
		// checks `isCliExecutableAvailable` via `existsSync`, so the path must actually exist, and
		// `process.execPath` is guaranteed to exist on every platform the test suite runs on.
		executable: process.execPath,
		mcpSupported: true,
		mcpInstalled: false,
		hooksSupported: true,
		hooksInstalled: false,
		...overrides,
	};
}

/** Seeds the service's private cache directly so accessors don't reach for the real `fetchAgents()`. */
function withAgents(agents: readonly GkAgent[]): AgentService {
	const service = new AgentService();
	(service as unknown as { _cache: { value: readonly GkAgent[]; expiresAt: number } })._cache = {
		value: agents,
		expiresAt: Date.now() + 100_000,
	};
	return service;
}

suite('AgentService', () => {
	// Uses the `agent()` helper's default `executable` (the running Node binary) so
	// `isCliExecutableAvailable`'s `existsSync` check passes deterministically.
	const claudeCli = agent({ name: 'claude-cli', type: 'cli', detected: true });
	const codexNotDetected = agent({ name: 'codex', type: 'cli', detected: false, executable: undefined });
	const cursor = agent({ name: 'cursor', type: 'gui', hooksSupported: true });
	const mysteryHookClient = agent({ name: 'mystery-hook-client', type: 'unknown', hooksSupported: true });

	suite('getDetectedCliAgents', () => {
		test('includes only type "cli" agents that are detected with an available executable', async () => {
			const service = withAgents([claudeCli, codexNotDetected, cursor, mysteryHookClient]);
			const result = await service.getDetectedCliAgents();
			assert.deepStrictEqual(
				result.map(a => a.name),
				['claude-cli'],
			);
		});
	});

	suite('getCliAgents', () => {
		test('includes every type "cli" agent regardless of detection state', async () => {
			const service = withAgents([claudeCli, codexNotDetected, cursor, mysteryHookClient]);
			const result = await service.getCliAgents();
			assert.deepStrictEqual(result.map(a => a.name).sort(), ['claude-cli', 'codex']);
		});
	});

	suite('getHookOnlyAgents', () => {
		test('includes hook-capable non-"cli" agents, including "unknown"-typed ones', async () => {
			const service = withAgents([claudeCli, codexNotDetected, cursor, mysteryHookClient]);
			const result = await service.getHookOnlyAgents();
			assert.deepStrictEqual(result.map(a => a.name).sort(), ['cursor', 'mystery-hook-client']);
		});

		test('an "unknown"-typed agent appears in getHookOnlyAgents but not getCliAgents', async () => {
			const service = withAgents([mysteryHookClient]);
			const [hookOnly, cli] = await Promise.all([service.getHookOnlyAgents(), service.getCliAgents()]);
			assert.deepStrictEqual(
				hookOnly.map(a => a.name),
				['mystery-hook-client'],
			);
			assert.deepStrictEqual(cli, []);
		});
	});
});
