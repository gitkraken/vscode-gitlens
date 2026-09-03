import * as assert from 'node:assert';
import { buildResumeCommandLine, toResumableSessionRef } from '../-webview/agentResume.js';
import type { AgentSession } from '../../provider.js';

suite('agentResume', () => {
	test('buildResumeCommandLine quotes only what needs quoting', () => {
		assert.strictEqual(buildResumeCommandLine('claude', ['--resume', 'abc']), 'claude --resume abc');
		assert.strictEqual(
			buildResumeCommandLine('/opt/Homebrew Cellar/codex', ['resume', 'abc']),
			'"/opt/Homebrew Cellar/codex" resume abc',
		);
		assert.strictEqual(buildResumeCommandLine('copilot', ['--resume=abc']), 'copilot --resume=abc');
	});

	test('toResumableSessionRef carries the provider and prefers the live cwd', () => {
		const session = {
			id: 's1',
			providerId: 'codex',
			cwd: '/live',
			initialCwd: '/launch',
			name: 'n',
		} as unknown as AgentSession;
		assert.deepStrictEqual(toResumableSessionRef(session), {
			providerId: 'codex',
			id: 's1',
			cwd: '/live',
			name: 'n',
		});
	});
});
