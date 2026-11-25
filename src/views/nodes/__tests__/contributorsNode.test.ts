import '../../../container.js';
import * as assert from 'node:assert';
import * as sinon from 'sinon';
import { l10n, Uri } from 'vscode';
import { GitCommit, GitCommitIdentity } from '@gitlens/git/models/commit.js';
import { GitContributor } from '@gitlens/git/models/contributor.js';
import type { GitFile } from '@gitlens/git/models/file.js';
import { GitFileChange } from '@gitlens/git/models/fileChange.js';
import type { GitLog } from '@gitlens/git/models/log.js';
import { GitUri } from '../../../git/gitUri.js';
import type { GlRepository } from '../../../git/models/repository.js';
import type { FilesQueryResults } from '../../../git/queryResults.js';
import { configuration } from '../../../system/-webview/configuration.js';
import type { ViewsWithContributorsNode } from '../../viewBase.js';
import type { ViewNode } from '../abstract/viewNode.js';
import { ContributorNode } from '../contributorNode.js';
import { ContributorsNode } from '../contributorsNode.js';
import { ResultsFilesNode } from '../resultsFilesNode.js';

suite('ContributorsNode comparison files', () => {
	let sandbox: sinon.SinonSandbox;
	let getFilesLog: sinon.SinonStub;
	let getWorkingFiles: sinon.SinonStub;
	let getContributors: sinon.SinonStub;
	let query: sinon.SinonStub<[], Promise<FilesQueryResults>>;
	let view: ViewsWithContributorsNode;
	let alice: GitContributor;
	let bob: GitContributor;

	setup(async () => {
		sandbox = sinon.createSandbox();
		alice = new GitContributor('/repo', 'Alice', 'alice@example.com', false, 2);
		bob = new GitContributor('/repo', 'Bob', 'bob@example.com', false, 1);
		const getLog = sandbox.stub().resolves(createLog([]));
		getFilesLog = getLog.withArgs(
			'base..tip',
			sinon.match({ includeFiles: true, limit: 0, merges: true, ordering: 'topo' }),
		);
		getContributors = sandbox.stub().resolves({ contributors: [alice, bob] });
		getWorkingFiles = sandbox.stub().resolves([]);
		query = sandbox.stub<[], Promise<FilesQueryResults>>().resolves({ label: 'Comparison files', files: [] });
		const git = {
			getAbsoluteUri: (path: string) => Uri.file(path),
			getRepositoryService: () => ({
				commits: { getLog: getLog },
				contributors: { getContributors: getContributors },
				diff: { getDiffStatus: getWorkingFiles },
				getBranchesAndTagsTipsLookup: () => Promise.resolve(() => undefined),
			}),
		};
		const { Container } = await import('../../../container.js');
		sandbox.stub(Container, 'instance').get(() => ({ git: git }));
		sandbox.stub(configuration, 'get').callsFake((() => undefined) as typeof configuration.get);
		view = {
			type: 'searchAndCompare',
			container: { git: git, vsls: { active: false } },
			config: { avatars: false, defaultItemLimit: 20, showRelativeDateMarkers: false },
			getNodeLastKnownLimit: () => undefined,
			nodeState: { getState: () => undefined, deleteState: () => {} },
		} as unknown as ViewsWithContributorsNode;
	});

	teardown(() => {
		sandbox.restore();
	});

	function createLog(commits: GitCommit[], more?: GitLog['more']): GitLog {
		return {
			repoPath: '/repo',
			commits: new Map(commits.map(commit => [commit.sha, commit])),
			count: commits.length,
			sha: undefined,
			limit: 0,
			hasMore: more != null,
			more: more,
		};
	}

	function createCommit(sha: string, author: GitContributor, files?: GitFile[], parents: string[] = []): GitCommit {
		const identity = new GitCommitIdentity(author.name, author.email, new Date('2026-01-01'));
		return new GitCommit(
			'/repo',
			sha,
			identity,
			identity,
			'Commit',
			parents,
			undefined,
			files && {
				files: files.map(file => toFileChange(file)),
			},
		);
	}

	function toFileChange(file: GitFile): GitFileChange {
		return new GitFileChange('/repo', file.path, file.status, Uri.file(`/repo/${file.path}`), file.originalPath);
	}

	function createNode(ref2: string = 'tip-sha'): ContributorsNode {
		return new ContributorsNode(
			GitUri.fromRepoPath('/repo'),
			view,
			{} as ViewNode,
			{ id: 'repo', path: '/repo' } as GlRepository,
			{ ref: 'base..tip', stats: false, files: { ref1: 'base-sha', ref2: ref2, query: query } },
		);
	}

	async function getContributorNode(node: ContributorsNode, contributor: GitContributor): Promise<ContributorNode> {
		const contributors = await node.getChildren();
		const child = contributors.find(child => child instanceof ContributorNode && child.contributor === contributor);
		assert.ok(child instanceof ContributorNode);
		return child;
	}

	async function getFilesNode(node: ContributorsNode, contributor: GitContributor): Promise<ResultsFilesNode> {
		const child = await getContributorNode(node, contributor);
		const [filesNode] = await child.getChildren();
		assert.ok(filesNode instanceof ResultsFilesNode);
		return filesNode;
	}

	test('shares all history pages between authors and preserves only their final comparison files', async () => {
		const files: GitFile[] = [
			{ path: 'alice-early.ts', status: 'M', stats: { additions: 3, deletions: 1, changes: 4 } },
			{ path: 'alice-later.ts', status: 'D' },
			{ path: 'bob.ts', status: 'A' },
			{ path: 'wrong-name.ts', status: 'M' },
			{ path: 'wrong-email.ts', status: 'M' },
		];
		query.resolves({
			label: 'All comparison files',
			files: files,
			stats: { files: 5, additions: 500, deletions: 200 },
		});
		const sameEmail = new GitContributor('/repo', 'Someone else', alice.email, false, 1);
		const sameName = new GitContributor('/repo', alice.name, 'other@example.com', false, 1);
		const lastPage = createLog([createCommit('old-alice', alice, [files[0]])]);
		const moreSecondPage = sandbox.stub().resolves(lastPage);
		const secondPage = createLog([createCommit('recent-alice', alice, [files[1]])], moreSecondPage);
		const moreFirstPage = sandbox.stub().resolves(secondPage);
		getFilesLog.resolves(
			createLog(
				[
					createCommit('bob', bob, [files[2]]),
					createCommit('wrong-name', sameEmail, [files[3]]),
					createCommit('wrong-email', sameName, [files[4]]),
				],
				moreFirstPage,
			),
		);
		const node = createNode();
		const aliceFiles = await getFilesNode(node, alice);
		const bobFiles = await getFilesNode(node, bob);
		sinon.assert.notCalled(getFilesLog);
		sinon.assert.notCalled(query);

		const [aliceComparison, bobComparison] = await Promise.all([
			aliceFiles.getFilesComparison(),
			bobFiles.getFilesComparison(),
		]);

		assert.deepStrictEqual(aliceComparison, {
			repoPath: '/repo',
			ref1: 'base-sha',
			ref2: 'tip-sha',
			files: files.slice(0, 2),
		});
		assert.strictEqual(aliceComparison.files[0], files[0]);
		assert.deepStrictEqual(bobComparison.files, [files[2]]);
		sinon.assert.calledOnceWithExactly(getFilesLog, 'base..tip', {
			includeFiles: true,
			limit: 0,
			merges: true,
			ordering: 'topo',
		});
		sinon.assert.calledOnce(query);
		sinon.assert.calledOnceWithExactly(moreFirstPage, 0);
		sinon.assert.calledOnceWithExactly(moreSecondPage, 0);
		assert.strictEqual((await aliceFiles.getTreeItem()).description, undefined);
	});

	test('loads missing non-merge file details without importing merge files', async () => {
		const authored: GitFile = { path: 'authored.ts', status: 'M' };
		const merged: GitFile = { path: 'merged.ts', status: 'A' };
		const missing = createCommit('missing-details', alice);
		const merge = createCommit('merge', alice, undefined, ['parent-one', 'parent-two']);
		getFilesLog.resolves(createLog([merge, missing]));
		query.resolves({ label: 'Comparison files', files: [authored, merged] });
		const ensureDetails = sandbox.stub(GitCommit, 'ensureFullDetails').callsFake(async commit => {
			assert.strictEqual(commit, missing);
			commit.applyFileset({ files: [toFileChange(authored)] });
		});
		const filesNode = await getFilesNode(createNode(), alice);

		const comparison = await filesNode.getFilesComparison();

		assert.deepStrictEqual(comparison.files, [authored]);
		sinon.assert.calledOnceWithExactly(ensureDetails, missing);
	});

	test('reloads shared history and contributors after refresh', async () => {
		const oldFile: GitFile = { path: 'old.ts', status: 'M' };
		const newFile: GitFile = { path: 'new.ts', status: 'A' };
		getFilesLog.onFirstCall().resolves(createLog([createCommit('old', alice, [oldFile])]));
		getFilesLog.onSecondCall().resolves(createLog([createCommit('new', alice, [newFile])]));
		query.onFirstCall().resolves({ label: 'Old files', files: [oldFile] });
		query.onSecondCall().resolves({ label: 'New files', files: [newFile] });
		const node = createNode();
		const oldFiles = await getFilesNode(node, alice);
		assert.deepStrictEqual((await oldFiles.getFilesComparison()).files, [oldFile]);

		node.refresh(true);
		const newFiles = await getFilesNode(node, alice);

		assert.notStrictEqual(newFiles, oldFiles);
		assert.deepStrictEqual((await newFiles.getFilesComparison()).files, [newFile]);
		sinon.assert.calledTwice(getFilesLog);
		sinon.assert.calledTwice(getContributors);
		sinon.assert.calledTwice(query);
	});

	(['contributor', 'files'] as const).forEach(target => {
		test(`invalidates shared comparison data when refreshing the ${target} node`, async () => {
			const oldFile: GitFile = { path: 'old.ts', status: 'M' };
			const newFile: GitFile = { path: 'new.ts', status: 'A' };
			getFilesLog.onFirstCall().resolves(createLog([createCommit('old', alice, [oldFile])]));
			getFilesLog.onSecondCall().resolves(createLog([createCommit('new', alice, [newFile])]));
			query.onFirstCall().resolves({ label: 'Old files', files: [oldFile] });
			query.onSecondCall().resolves({ label: 'New files', files: [newFile] });
			const node = createNode();
			const contributorNode = await getContributorNode(node, alice);
			const original = await getFilesNode(node, alice);
			assert.deepStrictEqual((await original.getFilesComparison()).files, [oldFile]);

			let updated: ResultsFilesNode;
			if (target === 'contributor') {
				contributorNode.refresh(true);
				updated = await getFilesNode(node, alice);
			} else {
				original.refresh(true);
				updated = original;
			}

			assert.deepStrictEqual((await updated.getFilesComparison()).files, [newFile]);
			sinon.assert.calledTwice(getFilesLog);
			sinon.assert.calledTwice(query);
			sinon.assert.calledOnce(getContributors);
		});
	});

	test('requests contributor identities with range statistics without showing disabled statistics', async () => {
		const contributor = new GitContributor(
			'/repo',
			'Alice',
			'alice@example.com',
			false,
			2,
			undefined,
			undefined,
			undefined,
			{
				files: 99,
				additions: 100,
				deletions: 50,
				contributionScore: 1,
			},
		);
		getContributors.resolves({ contributors: [contributor] });
		const child = await getContributorNode(createNode(), contributor);

		const item = await child.getTreeItem();

		sinon.assert.calledOnceWithExactly(
			getContributors,
			'base..tip',
			{ all: false, merges: undefined, stats: true },
			undefined,
			undefined,
		);
		assert.ok(typeof item.description === 'string');
		assert.doesNotMatch(item.description, /99|100|50/);
		assert.ok(item.tooltip != null && typeof item.tooltip !== 'string');
		assert.doesNotMatch(item.tooltip.value, /99|100|50/);
	});

	test('uses contribution SHAs when the current user identity differs from commit authors', async () => {
		const recorded: GitFile = { path: 'recorded.ts', status: 'M' };
		const other: GitFile = { path: 'other.ts', status: 'M' };
		const contributor = new GitContributor('/repo', 'You', 'display@example.com', true, 1, [
			{ sha: 'recorded', date: new Date('2026-01-01'), message: 'Recorded contribution' },
		]);
		const originalIdentity = new GitContributor('/repo', 'Original Author', 'original@example.com', false, 1);
		getContributors.resolves({ contributors: [contributor] });
		getFilesLog.resolves(
			createLog([
				createCommit('other', contributor, [other]),
				createCommit('recorded', originalIdentity, [recorded]),
			]),
		);
		query.resolves({ label: 'Comparison files', files: [recorded, other] });
		const filesNode = await getFilesNode(createNode(), contributor);

		const comparison = await filesNode.getFilesComparison();

		assert.deepStrictEqual(comparison.files, [recorded]);
	});

	test('shares working-tree identities when tracing renames and excluding recreated untracked files', async () => {
		const renamed: GitFile = { path: 'working.ts', originalPath: 'committed.ts', status: 'R' };
		const recreated: GitFile = { path: 'reused.ts', status: 'A' };
		getWorkingFiles.resolves([renamed, { path: recreated.path, status: '?' }]);
		getFilesLog.resolves(
			createLog([
				createCommit('authored', alice, [
					{ path: 'committed.ts', status: 'M' },
					{ path: recreated.path, status: 'D' },
				]),
			]),
		);
		query.resolves({ label: 'Comparison files', files: [renamed, recreated] });
		const node = createNode('');
		const aliceFiles = await getFilesNode(node, alice);
		const bobFiles = await getFilesNode(node, bob);

		const [aliceComparison, bobComparison] = await Promise.all([
			aliceFiles.getFilesComparison(),
			bobFiles.getFilesComparison(),
		]);

		assert.deepStrictEqual(aliceComparison, {
			repoPath: '/repo',
			ref1: 'base-sha',
			ref2: '',
			files: [renamed],
		});
		assert.strictEqual(aliceComparison.files[0], renamed);
		assert.deepStrictEqual(bobComparison.files, []);
		sinon.assert.calledOnceWithExactly(getWorkingFiles, 'HEAD', undefined, { includeUntracked: true });
		sinon.assert.calledOnce(getFilesLog);
		sinon.assert.calledOnce(query);
	});

	test('reports a failed comparison query and retries successfully after refresh', async () => {
		const file: GitFile = { path: 'recovered.ts', status: 'M' };
		getFilesLog.resolves(createLog([createCommit('authored', alice, [file])]));
		query.onFirstCall().rejects(new Error('Comparison query unavailable'));
		query.onSecondCall().resolves({ label: 'Comparison files', files: [file] });
		const filesNode = await getFilesNode(createNode(), alice);

		const failed = await filesNode.getTreeItem();

		assert.strictEqual(failed.label, l10n.t('Unable to load files touched'));
		assert.deepStrictEqual((await filesNode.getFilesComparison()).files, []);

		filesNode.refresh(true);
		const comparison = await filesNode.getFilesComparison();

		assert.deepStrictEqual(comparison, {
			repoPath: '/repo',
			ref1: 'base-sha',
			ref2: 'tip-sha',
			files: [file],
		});
		sinon.assert.calledTwice(query);
		sinon.assert.calledTwice(getFilesLog);
	});

	test('reports unavailable files when history pagination cannot finish', async () => {
		const file: GitFile = { path: 'partial.ts', status: 'M' };
		getFilesLog.resolves({ ...createLog([createCommit('partial', alice, [file])]), hasMore: true });
		query.resolves({ label: 'Comparison files', files: [file] });
		const filesNode = await getFilesNode(createNode(), alice);

		const item = await filesNode.getTreeItem();

		assert.strictEqual(item.label, l10n.t('Unable to load files touched'));
		assert.deepStrictEqual((await filesNode.getFilesComparison()).files, []);
	});
});
