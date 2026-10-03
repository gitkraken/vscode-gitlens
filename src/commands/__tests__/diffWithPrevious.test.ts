import * as assert from 'node:assert';
// Initialize the container before the command decorators' circular imports.
import '../../container.js';
import * as sinon from 'sinon';
import { commands, Uri } from 'vscode';
import type { GitCommit } from '@gitlens/git/models/commit.js';
import type { GitFileStatus } from '@gitlens/git/models/fileStatus.js';
import { deletedOrMissing } from '@gitlens/git/models/revision.js';
import type { Container } from '../../container.js';
import type { DiffWithCommandArgs } from '../diffWith.js';
import { DiffWithCommand } from '../diffWith.js';
import { DiffWithPreviousCommand } from '../diffWithPrevious.js';

suite('DiffWithPreviousCommand committed files', () => {
	const repoPath = '/test/repo';
	const fileUri = Uri.file(`${repoPath}/file.txt`);
	const originalUri = Uri.file(`${repoPath}/original.txt`);
	let sandbox: sinon.SinonSandbox;
	let executeCommand: sinon.SinonStub;
	let resolveRevision: sinon.SinonStub;
	let command: DiffWithPreviousCommand;

	setup(() => {
		sandbox = sinon.createSandbox();
		executeCommand = sandbox.stub(commands, 'executeCommand');
		resolveRevision = sandbox.stub();
		const container = {
			git: {
				getRepositoryService: () => ({
					revision: { resolveRevision: resolveRevision },
					getBestRevisionUri: (uri: Uri, sha: string) => {
						return Promise.resolve(
							sha === deletedOrMissing ? undefined : uri.with({ scheme: 'test', query: sha }),
						);
					},
					getRevisionUri: (sha: string, path: string) => Uri.file(path).with({ scheme: 'test', query: sha }),
					getAbsoluteUri: (path: string) => Uri.file(`${repoPath}/${path}`),
				}),
			},
		} as unknown as Container;
		// Invoke the real shared command, without registering duplicate extension commands.
		const diffCommand = Object.create(DiffWithCommand.prototype) as DiffWithCommand;
		(diffCommand as unknown as { container: Container }).container = container;
		executeCommand.callsFake((id: string, args: DiffWithCommandArgs) => {
			return id === 'gitlens.diffWith' ? diffCommand.execute(args) : Promise.resolve();
		});
		command = Object.create(DiffWithPreviousCommand.prototype) as DiffWithPreviousCommand;
		(command as unknown as { container: Container }).container = container;
	});

	teardown(() => {
		sandbox.restore();
	});

	function commit(status: GitFileStatus): GitCommit {
		return {
			repoPath: repoPath,
			sha: 'current',
			isUncommitted: false,
			file: { status: status, uri: fileUri, originalUri: status === 'R' ? originalUri : undefined },
		} as unknown as GitCommit;
	}

	function assertDiff(lhsSha: string, rhsSha: string, lhsUri = fileUri): void {
		assert.strictEqual(executeCommand.callCount, 2);
		const [id, lhs, rhs] = executeCommand.secondCall.args as [string, Uri, Uri];
		assert.strictEqual(id, 'vscode.diff');
		assert.strictEqual(lhs.query, lhsSha);
		assert.strictEqual(rhs.query, rhsSha);
		assert.strictEqual(lhs.fsPath, lhsUri.fsPath);
		assert.strictEqual(rhs.fsPath, fileUri.fsPath);
	}

	(['D', 'R', undefined] as const).forEach(previousStatus => {
		test(`a re-added file compares against empty with previous status ${previousStatus ?? 'unavailable'}`, async () => {
			// D: delete/re-add; R: rename away/re-add; omitted: browser resolution has no status.
			resolveRevision.callsFake((sha: string) => {
				if (sha === deletedOrMissing) return Promise.resolve({ sha: sha, revision: sha });
				if (sha === 'current') {
					return Promise.resolve({
						sha: sha,
						revision: sha,
						status: previousStatus == null ? undefined : 'A',
					});
				}

				return Promise.resolve({ sha: 'previous', revision: sha, status: previousStatus, path: 'renamed.txt' });
			});

			await command.execute(undefined, undefined, { commit: commit('A') });

			assertDiff(deletedOrMissing, 'current');
			assert.ok(resolveRevision.calledWith(deletedOrMissing, fileUri));
			assert.ok(!resolveRevision.calledWith('current^'));
		});
	});

	test('a modified file retains the parent comparison', async () => {
		resolveRevision.onFirstCall().resolves({ sha: 'previous', revision: 'current^', status: 'M' });
		resolveRevision.onSecondCall().resolves({ sha: 'current', revision: 'current', status: 'M' });

		await command.execute(undefined, undefined, { commit: commit('M') });

		assertDiff('previous', 'current');
		assert.ok(resolveRevision.calledWith('current^', fileUri));
	});

	test('a renamed file compares the original parent path with the destination', async () => {
		resolveRevision.onFirstCall().resolves({ sha: 'previous', revision: 'current^', status: 'M' });
		resolveRevision.onSecondCall().resolves({ sha: 'current', revision: 'current', status: 'R', path: 'file.txt' });

		await command.execute(undefined, undefined, { commit: commit('R') });

		assertDiff('previous', 'current', originalUri);
		assert.ok(resolveRevision.calledWith('current^', originalUri));
	});

	test('an untracked stash file compares empty with its third parent', async () => {
		resolveRevision.callsFake((sha: string) => Promise.resolve({ sha: sha, revision: sha }));

		await command.execute(undefined, undefined, { commit: commit('?') });

		assertDiff(deletedOrMissing, 'current^3');
		assert.ok(resolveRevision.calledWith('current^3', fileUri));
	});
});
