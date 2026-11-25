import '../../../container.js';
import * as assert from 'node:assert';
import * as sinon from 'sinon';
import { Uri } from 'vscode';
import { GitCommit, GitCommitIdentity } from '@gitlens/git/models/commit.js';
import { GitContributor } from '@gitlens/git/models/contributor.js';
import type { GitFile } from '@gitlens/git/models/file.js';
import { GitFileChange } from '@gitlens/git/models/fileChange.js';
import type { GitLog } from '@gitlens/git/models/log.js';
import type { GlRepository } from '../../../git/models/repository.js';
import type { CommitsQueryResults, FilesQueryResults } from '../../../git/queryResults.js';
import { configuration } from '../../../system/-webview/configuration.js';
import type { ViewsWithCommits } from '../../viewBase.js';
import type { ViewNode } from '../abstract/viewNode.js';
import { CommitNode } from '../commitNode.js';
import { ContributorNode } from '../contributorNode.js';
import { ContributorsNode } from '../contributorsNode.js';
import { ResultsCommitsNode } from '../resultsCommitsNode.js';
import { ResultsFilesNode } from '../resultsFilesNode.js';

suite('ResultsCommitsNode contributor files configuration', () => {
	let sandbox: sinon.SinonSandbox;
	let getContributors: sinon.SinonStub;
	let getFilesLog: sinon.SinonStub;
	let queryFiles: sinon.SinonStub<[], Promise<FilesQueryResults>>;
	let queryCommits: sinon.SinonStub<[number | undefined], Promise<CommitsQueryResults>>;
	let view: ViewsWithCommits;
	let config: { showContributorsFiles: boolean };
	const file: GitFile = { path: 'authored.ts', status: 'M' };

	setup(async () => {
		sandbox = sinon.createSandbox();
		const contributor = new GitContributor('/repo', 'Alice', 'alice@example.com', false, 1);
		const identity = new GitCommitIdentity(contributor.name, contributor.email, new Date('2026-01-01'));
		const commit = new GitCommit('/repo', 'a'.repeat(40), identity, identity, 'Authored commit', [], undefined, {
			files: [new GitFileChange('/repo', file.path, file.status, Uri.file(`/repo/${file.path}`))],
		});
		const log: GitLog = {
			repoPath: '/repo',
			commits: new Map([[commit.sha, commit]]),
			count: 1,
			sha: undefined,
			limit: 20,
			hasMore: false,
		};
		const getLog = sandbox.stub().resolves(log);
		getFilesLog = getLog.withArgs('base..tip', sinon.match({ includeFiles: true }));
		getContributors = sandbox.stub().resolves({ contributors: [contributor] });
		queryFiles = sandbox
			.stub<[], Promise<FilesQueryResults>>()
			.resolves({ label: 'Comparison files', files: [file] });
		queryCommits = sandbox.stub<[number | undefined], Promise<CommitsQueryResults>>().resolves({
			log: log,
			hasMore: false,
		});
		const git = {
			getAbsoluteUri: (path: string) => Uri.file(path),
			getRepository: () => ({ id: 'repo', path: '/repo' }) as unknown as GlRepository,
			getRepositoryService: () => ({
				commits: { getLog: getLog },
				contributors: { getContributors: getContributors },
				getBranchesAndTagsTipsLookup: () => Promise.resolve(() => undefined),
			}),
		};
		const { Container } = await import('../../../container.js');
		sandbox.stub(Container, 'instance').get(() => ({ git: git }));
		sandbox.stub(configuration, 'get').callsFake((() => undefined) as typeof configuration.get);
		config = {
			showContributorsFiles: true,
		};
		view = {
			type: 'searchAndCompare',
			container: { git: git, vsls: { active: false } },
			config: Object.assign(config, {
				avatars: false,
				defaultItemLimit: 20,
				showComparisonContributors: true,
				showContributorsStatistics: false,
				showRelativeDateMarkers: false,
			}),
			getNodeLastKnownLimit: () => undefined,
			nodeState: { getState: () => undefined, deleteState: () => {} },
		} as unknown as ViewsWithCommits;
	});

	teardown(() => {
		sandbox.restore();
	});

	function createNode(): ResultsCommitsNode {
		return new ResultsCommitsNode(
			view,
			{} as ViewNode,
			'/repo',
			'Comparison commits',
			{
				query: queryCommits,
				comparison: { ref1: 'base', ref2: 'tip', range: 'base..tip' },
				files: { ref1: 'base', ref2: 'tip', query: queryFiles },
			},
			{ autolinks: false },
		);
	}

	async function getContributorChildren(node: ResultsCommitsNode): Promise<ViewNode[]> {
		const children = await node.getChildren();
		assert.ok(children.some(child => child instanceof CommitNode));
		assert.ok(children.some(child => child instanceof ResultsFilesNode));
		const contributorsNode = children.find(child => child instanceof ContributorsNode);
		assert.ok(contributorsNode instanceof ContributorsNode);
		const contributors = await contributorsNode.getChildren();
		const contributorNode = contributors.find(child => child instanceof ContributorNode);
		assert.ok(contributorNode instanceof ContributorNode);
		return contributorNode.getChildren();
	}

	test('shows contributor files when enabled and loads their history lazily', async () => {
		const children = await getContributorChildren(createNode());
		assert.ok(children.some(child => child instanceof CommitNode));
		const filesNode = children.find(child => child instanceof ResultsFilesNode);
		assert.ok(filesNode instanceof ResultsFilesNode);
		sinon.assert.calledOnceWithExactly(
			getContributors,
			'base..tip',
			{ all: false, merges: undefined, stats: true },
			undefined,
			undefined,
		);
		sinon.assert.notCalled(queryFiles);
		sinon.assert.notCalled(getFilesLog);

		assert.deepStrictEqual((await filesNode.getFilesComparison()).files, [file]);
		sinon.assert.calledOnce(queryFiles);
		sinon.assert.calledOnce(getFilesLog);
	});

	test('hides contributor files when disabled without forcing statistics or loading file history', async () => {
		config.showContributorsFiles = false;

		const children = await getContributorChildren(createNode());

		assert.strictEqual(children.length, 1);
		assert.ok(children[0] instanceof CommitNode);
		sinon.assert.calledOnceWithExactly(
			getContributors,
			'base..tip',
			{ all: false, merges: undefined, stats: false },
			undefined,
			undefined,
		);
		sinon.assert.notCalled(queryFiles);
		sinon.assert.notCalled(getFilesLog);
	});

	test('applies changed contributor files settings when rebuilding comparison children', async () => {
		const node = createNode();
		for (const enabled of [true, false, true]) {
			config.showContributorsFiles = enabled;
			node.refresh(true);

			const children = await getContributorChildren(node);

			assert.strictEqual(
				children.some(child => child instanceof ResultsFilesNode),
				enabled,
			);
			assert.ok(children.some(child => child instanceof CommitNode));
		}

		sinon.assert.notCalled(queryFiles);
		sinon.assert.notCalled(getFilesLog);
	});
});
