import * as assert from 'node:assert';
import type { GkAgent } from '../../../../agents/agentService.js';
import type { AgentDescriptor } from '../../../../plus/agents/agentDescriptor.js';
import { toAgentInfo } from '../agents.js';

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
