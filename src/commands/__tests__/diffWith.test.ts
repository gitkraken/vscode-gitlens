import * as assert from 'node:assert';
// Initialize the container before the command decorators' circular imports.
import '../../container.js';
import * as sinon from 'sinon';
import { commands, Uri } from 'vscode';
import { GitCommit } from '@gitlens/git/models/commit.js';
import { deletedOrMissing } from '@gitlens/git/models/revision.js';
import type { ResolvedRevision } from '@gitlens/git/providers/revision.js';
import type { Container } from '../../container.js';
import type { DiffWithCommandArgs } from '../diffWith.js';
import { DiffWithCommand } from '../diffWith.js';

suite('DiffWithCommand', () => {
	const repoPath = '/test/repo';
	const fileUri = Uri.file(`${repoPath}/file.txt`);
	let sandbox: sinon.SinonSandbox;
	let executeCommand: sinon.SinonStub;
	let resolveRevision: sinon.SinonStub;
	let getBestRevisionUri: sinon.SinonStub;
	let command: DiffWithCommand;

	setup(() => {
		sandbox = sinon.createSandbox();
		executeCommand = sandbox.stub(commands, 'executeCommand').resolves();
		resolveRevision = sandbox.stub();
		getBestRevisionUri = sandbox.stub().callsFake((uri: Uri, sha: string) => {
			return Promise.resolve(sha === deletedOrMissing ? undefined : uri.with({ scheme: 'test', query: sha }));
		});
		const container = {
			git: {
				getRepositoryService: () => ({
					revision: { resolveRevision: resolveRevision },
					getBestRevisionUri: getBestRevisionUri,
					getRevisionUri: (sha: string, path: string) => Uri.file(path).with({ scheme: 'test', query: sha }),
					getAbsoluteUri: (path: string) => Uri.file(`${repoPath}/${path}`),
				}),
			},
		} as unknown as Container;
		// Avoid registering a second instance of the running extension's command.
		command = Object.create(DiffWithCommand.prototype) as DiffWithCommand;
		(command as unknown as { container: Container }).container = container;
	});

	teardown(() => {
		sandbox.restore();
	});

	function args(lhsSha = 'older', rhsSha = 'newer'): DiffWithCommandArgs {
		return {
			repoPath: repoPath,
			lhs: { sha: lhsSha, uri: fileUri },
			rhs: { sha: rhsSha, uri: fileUri },
			fromComparison: true,
		};
	}

	function assertDiff(lhsSha: string, rhsSha: string, lhsUri = fileUri, rhsUri = fileUri): void {
		assert.strictEqual(executeCommand.callCount, 1);
		const [id, lhs, rhs] = executeCommand.firstCall.args as [string, Uri, Uri];
		assert.strictEqual(id, 'vscode.diff');
		assert.strictEqual(lhs.query, lhsSha);
		assert.strictEqual(rhs.query, rhsSha);
		assert.strictEqual(lhs.fsPath, lhsUri.fsPath);
		assert.strictEqual(rhs.fsPath, rhsUri.fsPath);
	}

	for (const status of ['A', '?'] as const) {
		test(`a Markdown link for a committed ${status} file selects an empty left revision`, () => {
			const commit = Object.create(GitCommit.prototype) as GitCommit;
			Object.defineProperties(commit, {
				repoPath: { value: repoPath },
				sha: { value: 'readded' },
				file: { value: { status: status, uri: fileUri } },
				unresolvedPreviousSha: { value: 'readded^' },
			});

			const link = DiffWithCommand.createMarkdownCommandLink(commit);
			const payload = JSON.parse(decodeURIComponent(link.slice(link.indexOf('?') + 1))) as DiffWithCommandArgs;

			assert.strictEqual(payload.lhs.sha, deletedOrMissing);
			assert.strictEqual(payload.rhs.sha, status === '?' ? 'readded^3' : 'readded');
		});
	}

	test('a Markdown link built from explicit historical comparison arguments preserves its revisions', () => {
		const comparison = args('original', 'readded');

		const link = DiffWithCommand.createMarkdownCommandLink(comparison);
		const payload = JSON.parse(decodeURIComponent(link.slice(link.indexOf('?') + 1))) as DiffWithCommandArgs;

		assert.strictEqual(payload.lhs.sha, 'original');
		assert.strictEqual(payload.rhs.sha, 'readded');
	});

	test('a deleted left revision opens an empty side without changing the cached resolution', async () => {
		const lhs = Object.freeze({ sha: 'deleted', revision: 'deleted', status: 'D' } satisfies ResolvedRevision);
		const rhs = Object.freeze({ sha: 'readded', revision: 'readded', status: 'A' } satisfies ResolvedRevision);
		resolveRevision.onFirstCall().resolves(lhs);
		resolveRevision.onSecondCall().resolves(rhs);

		await command.execute(args('deleted', 'readded'));

		assertDiff(deletedOrMissing, 'readded');
		assert.strictEqual(lhs.sha, 'deleted');
		assert.strictEqual(rhs.sha, 'readded');
	});

	test('a deleted right revision opens an empty side without changing the cached resolution', async () => {
		const lhs = Object.freeze({ sha: 'original', revision: 'original', status: 'A' } satisfies ResolvedRevision);
		const rhs = Object.freeze({ sha: 'deleted', revision: 'deleted', status: 'D' } satisfies ResolvedRevision);
		resolveRevision.onFirstCall().resolves(lhs);
		resolveRevision.onSecondCall().resolves(rhs);

		await command.execute(args('original', 'deleted'));

		assertDiff('original', deletedOrMissing);
		assert.strictEqual(rhs.sha, 'deleted');
	});

	test('the same cached deletion returned for both sides stays unchanged', async () => {
		const resolved = Object.freeze({ sha: 'deleted', revision: 'deleted', status: 'D' } satisfies ResolvedRevision);
		resolveRevision.resolves(resolved);

		await command.execute(args('deleted', 'deleted'));

		assertDiff(deletedOrMissing, deletedOrMissing);
		assert.strictEqual(resolved.sha, 'deleted');
	});

	test('comparing a re-added file with its original version preserves both revisions', async () => {
		resolveRevision.onFirstCall().resolves({ sha: 'original', revision: 'original', status: 'A' });
		resolveRevision.onSecondCall().resolves({ sha: 'readded', revision: 'readded', status: 'A' });

		await command.execute(args('original', 'readded'));

		assertDiff('original', 'readded');
	});

	test('a parent-suffixed historical reference that contains the file retains its contents', async () => {
		const parentRef = `${'a'.repeat(40)}^`;
		resolveRevision.onFirstCall().resolves({ sha: 'original', revision: parentRef, status: 'A' });
		resolveRevision.onSecondCall().resolves({ sha: 'readded', revision: 'readded', status: 'A' });

		await command.execute(args(parentRef, 'readded'));

		assertDiff('original', 'readded');
	});

	test('an unresolved parent of an added file opens empty without changing its cached resolution', async () => {
		const parentRef = `${'b'.repeat(40)}^`;
		const lhs = Object.freeze({ sha: parentRef, revision: parentRef });
		const rhs = Object.freeze({ sha: 'added', revision: 'added', status: 'A' } satisfies ResolvedRevision);
		resolveRevision.onFirstCall().resolves(lhs);
		resolveRevision.onSecondCall().resolves(rhs);

		await command.execute(args(parentRef, 'added'));

		assertDiff(deletedOrMissing, 'added');
		assert.strictEqual(lhs.sha, parentRef);
	});

	test('a rename comparison uses the destination path and retains the original left side', async () => {
		const renamedUri = Uri.file(`${repoPath}/renamed.txt`);
		resolveRevision.onFirstCall().resolves({ sha: 'original', revision: 'original', status: 'M' });
		resolveRevision
			.onSecondCall()
			.resolves({ sha: 'renamed', revision: 'renamed', status: 'R', path: 'renamed.txt' });

		await command.execute(args('original', 'renamed'));

		assertDiff('original', 'renamed', fileUri, renamedUri);
	});

	test('deleted revisions found by the swapped-path retry are normalized without changing its cached results', async () => {
		const oldUri = Uri.file(`${repoPath}/old.txt`);
		const newUri = Uri.file(`${repoPath}/new.txt`);
		const missing = Object.freeze({ sha: deletedOrMissing, revision: 'missing' });
		const deleted = Object.freeze({ sha: 'deleted', revision: 'deleted', status: 'D' } satisfies ResolvedRevision);
		const existing = Object.freeze({
			sha: 'existing',
			revision: 'existing',
			status: 'M',
		} satisfies ResolvedRevision);
		resolveRevision.onCall(0).resolves(missing);
		resolveRevision.onCall(1).resolves(missing);
		resolveRevision.onCall(2).resolves(deleted);
		resolveRevision.onCall(3).resolves(existing);

		await command.execute({
			...args(),
			lhs: { sha: 'older', uri: oldUri },
			rhs: { sha: 'newer', uri: newUri },
		});

		assertDiff(deletedOrMissing, 'existing', oldUri, oldUri);
		assert.strictEqual(resolveRevision.getCall(2).args[1], newUri);
		assert.strictEqual(resolveRevision.getCall(3).args[1], oldUri);
		assert.strictEqual(deleted.sha, 'deleted');
		assert.strictEqual(existing.sha, 'existing');
	});
});
