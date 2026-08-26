import * as assert from 'node:assert';
import type { GkAgent } from '../../../../agents/agentService.js';
import type { Container } from '../../../../container.js';
import type { AgentDescriptor } from '../../../../plus/agents/agentDescriptor.js';
import { AgentsService, toAgentInfo, toHookOnlyAgentInfo } from '../agents.js';

function cliAgent(overrides?: Partial<GkAgent>): GkAgent {
	return {
		name: 'claude-cli',
		displayName: 'Claude Code',
		detected: true,
		executable: '/usr/bin/claude',
		mcpSupported: true,
		mcpInstalled: false,
		hooksSupported: true,
		hooksInstalled: false,
		...overrides,
	};
}

suite('AgentsService.getPastSessionsForWorktree', () => {
	test('requests the normalized past collection with the caller limit', async () => {
		let requestedOptions: { limit?: number } | undefined;
		const container = {
			agentStatus: {
				getPastSessions: (_worktreePath: string, options?: { limit?: number }) => {
					requestedOptions = options;
					return Promise.resolve({ sessions: [], total: 0 });
				},
			},
		} as unknown as Container;
		const service = new AgentsService(container);

		await service.getPastSessionsForWorktree('/repo/worktree', { limit: 3 });

		assert.deepStrictEqual(requestedOptions, { limit: 3 });
	});
});

suite('AgentsService.getPastSessionDetail', () => {
	test('requests the detail through the host service and returns its result', async () => {
		let requested: { sessionId: string; providerId: string | undefined; cwd: string | undefined } | undefined;
		const container = {
			agentStatus: {
				getPastSessionDetail: (sessionId: string, providerId: string | undefined, cwd?: string) => {
					requested = { sessionId: sessionId, providerId: providerId, cwd: cwd };
					return Promise.resolve({ lastPrompt: 'hi' });
				},
			},
		} as unknown as Container;
		const service = new AgentsService(container);

		const result = await service.getPastSessionDetail('session-1', 'claudeCode', '/repo');

		assert.deepStrictEqual(requested, { sessionId: 'session-1', providerId: 'claudeCode', cwd: '/repo' });
		assert.deepStrictEqual(result, { lastPrompt: 'hi' });
	});

	test('returns undefined when agents are unavailable', async () => {
		const container = { agentStatus: undefined } as unknown as Container;
		const service = new AgentsService(container);

		assert.strictEqual(await service.getPastSessionDetail('session-1', 'claudeCode', '/repo'), undefined);
	});
});

suite('AgentsService.archiveSession', () => {
	test('routes the transcript-backed session to the host service', async () => {
		let requested: { sessionId: string; providerId?: string } | undefined;
		const container = {
			agentStatus: {
				archiveSession: (sessionId: string, providerId?: string) => {
					requested = { sessionId: sessionId, providerId: providerId };
					return Promise.resolve(true);
				},
			},
		} as unknown as Container;
		const service = new AgentsService(container);

		assert.strictEqual(await service.archiveSession('session-1', 'claudeCode'), true);
		assert.deepStrictEqual(requested, { sessionId: 'session-1', providerId: 'claudeCode' });
	});
});

suite('toAgentInfo', () => {
	test('maps an ide-chat descriptor with no mcp/hooks', () => {
		const d: AgentDescriptor = { id: 'ide-chat', kind: 'ide-chat', host: 'code', label: 'Copilot Chat' };
		assert.deepStrictEqual(toAgentInfo(d), {
			id: 'ide-chat',
			label: 'Copilot Chat',
			kind: 'ide-chat',
			mcp: undefined,
			hooks: undefined,
		});
	});

	test('maps a claude-extension descriptor with no mcp/hooks', () => {
		const d: AgentDescriptor = { id: 'claude-extension', kind: 'claude-extension', label: 'Claude Code Extension' };
		assert.deepStrictEqual(toAgentInfo(d), {
			id: 'claude-extension',
			label: 'Claude Code Extension',
			kind: 'claude-extension',
			mcp: undefined,
			hooks: undefined,
		});
	});

	test('maps a cli descriptor carrying mcp/hooks capability flags', () => {
		const agent = cliAgent({ mcpInstalled: true, hooksSupported: false });
		const d: AgentDescriptor = { id: 'cli:claude-cli', kind: 'cli', agent: agent, label: 'Claude Code' };
		assert.deepStrictEqual(toAgentInfo(d), {
			id: 'cli:claude-cli',
			label: 'Claude Code',
			kind: 'cli',
			mcp: { supported: true, installed: true },
			hooks: { supported: false, installed: false },
		});
	});
});

suite('toHookOnlyAgentInfo', () => {
	test('maps a hook-capable editor agent to an editor-kind row with read-only mcp state', () => {
		const agent = cliAgent({
			name: 'cursor',
			displayName: 'Cursor',
			detected: true,
			mcpInstalled: true,
			hooksInstalled: true,
		});
		assert.deepStrictEqual(toHookOnlyAgentInfo(agent), {
			id: 'cursor',
			label: 'Cursor',
			kind: 'editor',
			detected: true,
			mcp: { supported: true, installed: true },
			hooks: { supported: true, installed: true },
		});
	});

	test('carries detected: false through for the dimmed "Not detected" row treatment', () => {
		const agent = cliAgent({ name: 'antigravity', displayName: 'Antigravity', detected: false });
		assert.deepStrictEqual(toHookOnlyAgentInfo(agent), {
			id: 'antigravity',
			label: 'Antigravity',
			kind: 'editor',
			detected: false,
			mcp: { supported: true, installed: false },
			hooks: { supported: true, installed: false },
		});
	});
});
