import * as assert from 'node:assert';
import type { PastAgentSessionState } from '../../agents/models/agentSessionState.js';
import type { AgentSession } from '../../agents/provider.js';
import { buildResumableSessionItems } from '../resumableSessionPicker.js';

function makeLiveSession(overrides: Partial<AgentSession> & { id: string }): AgentSession {
	return {
		providerId: 'codex',
		providerName: 'Codex',
		status: 'idle',
		phase: 'idle',
		lastActivity: new Date(0),
		phaseSince: new Date(0),
		isSubagent: false,
		isInWorkspace: true,
		...overrides,
	};
}

function makePastSession(overrides: Partial<PastAgentSessionState> & { id: string }): PastAgentSessionState {
	return {
		providerId: 'claudeCode',
		disposition: 'ended',
		actions: {},
		worktreePath: '/repo',
		displayName: overrides.id,
		lastActivity: 0,
		...overrides,
	};
}

suite('buildResumableSessionItems', () => {
	test('a past row with two targets gets two buttons in [extension, terminal] order', () => {
		const past = makePastSession({
			id: 'p1',
			actions: { resume: { cwd: '/repo', targets: ['extension', 'terminal'] } },
		});
		const [, item] = buildResumableSessionItems([], [past], 1);

		assert.strictEqual(item.buttons?.length, 2);
		assert.match(item.buttons[0].tooltip ?? '', /Resume in .* Extension/);
		assert.strictEqual(item.buttons[1].tooltip, 'Resume in Terminal');
	});

	test('a past row with one target gets one button', () => {
		const past = makePastSession({ id: 'p1', actions: { resume: { cwd: '/repo', targets: ['terminal'] } } });
		const [, item] = buildResumableSessionItems([], [past], 1);

		assert.strictEqual(item.buttons?.length, 1);
		assert.strictEqual(item.buttons[0].tooltip, 'Resume in Terminal');
	});

	test('a live working row has no button', () => {
		const live = makeLiveSession({ id: 'l1', phase: 'working' });
		const [, item] = buildResumableSessionItems([live], [], 0);

		assert.strictEqual(item.buttons, undefined);
	});

	test('a live idle row offers a terminal button when its agent supports resume', () => {
		const live = makeLiveSession({ id: 'l1', providerId: 'codex', phase: 'idle' });
		const [, item] = buildResumableSessionItems([live], [], 0);

		assert.strictEqual(item.buttons?.length, 1);
		assert.strictEqual(item.buttons[0].tooltip, 'Resume in Terminal');
	});
});
