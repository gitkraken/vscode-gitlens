import * as assert from 'assert';
import type { Remote } from '@eamodio/supertalk';
import type { PastAgentSessionsResult } from '../../../../../../agents/models/agentSessionState.js';
import type { GraphServices } from '../../../../../plus/graph/graphService.js';
import { resolveDetailsActions } from '../detailsResolver.js';
import { createDetailsState } from '../detailsState.js';

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(r => (resolve = r));
	return { promise: promise, resolve: resolve };
}

suite('resolveDetailsActions', () => {
	test('does not await agents until past sessions are fetched', async () => {
		const agents = deferred<Awaited<Remote<GraphServices>['agents']>>();
		const service = {};
		const services = {
			agents: agents.promise,
			files: Promise.resolve(service),
			drafts: Promise.resolve(service),
			graphInspect: Promise.resolve(service),
			autolinks: Promise.resolve(service),
			branches: Promise.resolve(service),
			pullRequests: Promise.resolve(service),
			repository: Promise.resolve(service),
			config: Promise.resolve(service),
			storage: Promise.resolve(service),
			subscription: Promise.resolve(service),
			integrations: Promise.resolve(service),
			commands: Promise.resolve(service),
			ai: Promise.resolve(service),
			telemetry: Promise.resolve(service),
		} as unknown as Remote<GraphServices>;

		const timeout = new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error('details initialization waited for agents')), 50),
		);
		const actions = await Promise.race([resolveDetailsActions(services, createDetailsState()), timeout]);

		const expected: PastAgentSessionsResult = { sessions: [], total: 0 };
		let requested: { path: string; limit: number; signal: AbortSignal } | undefined;
		const fetch = actions.resources.pastAgentSessions.fetch('/repo/worktree');
		agents.resolve({
			getPastSessionsForWorktree: async (path, options, signal) => {
				requested = {
					path: path,
					limit: options?.limit ?? 0,
					signal: signal!,
				};
				return expected;
			},
		} as Awaited<Remote<GraphServices>['agents']>);
		await fetch;

		assert.strictEqual(requested?.path, '/repo/worktree');
		assert.strictEqual(requested?.limit, 3);
		assert.ok(requested?.signal instanceof AbortSignal);
		assert.strictEqual(actions.resources.pastAgentSessions.value.get(), expected);

		await actions.resources.pastAgentSessions.fetch('/repo/worktree', 18);
		assert.strictEqual(requested?.limit, 18);
	});
});
