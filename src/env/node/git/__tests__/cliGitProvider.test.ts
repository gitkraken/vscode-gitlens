import * as assert from 'node:assert';
// Imported for its side effect, FIRST and deliberately — see agentStatusService.test.ts: letting
// container initialize first breaks the decorator-registry import cycle.
import '../../../../container.js';
import { Git } from '@gitlens/git-cli/exec/git.js';
import { clearPendingCommandsForReset } from '../cliGitProvider.js';

type PendingCommands = Map<string, { cwd: string | undefined; promise: Promise<unknown> }>;

suite('clearPendingCommandsForReset', () => {
	let git: Git;
	let pending: PendingCommands;

	setup(() => {
		git = new Git(async () => ({ path: 'git', version: '2.40.0' }));
		pending = (git as unknown as { pendingCommands: PendingCommands }).pendingCommands;
		pending.set('a', { cwd: '/repo-a', promise: Promise.resolve() });
		pending.set('b', { cwd: '/repo-b', promise: Promise.resolve() });
	});

	test("a reset in one repository keeps another repository's in-flight run shareable", () => {
		clearPendingCommandsForReset(git, { repoPath: '/repo-a' });

		assert.deepStrictEqual([...pending.keys()], ['b']);
	});

	test('a reset naming no repository drops every in-flight run', () => {
		clearPendingCommandsForReset(git, { types: ['branches'] });

		assert.strictEqual(pending.size, 0);
	});

	test('a reset with an empty types list, meaning every type, drops every in-flight run', () => {
		clearPendingCommandsForReset(git, { types: [] });

		assert.strictEqual(pending.size, 0);
	});

	test('a providers-only reset drops nothing', () => {
		clearPendingCommandsForReset(git, { repoPath: '/repo-a', types: ['providers'] });

		assert.strictEqual(pending.size, 2);
	});
});
