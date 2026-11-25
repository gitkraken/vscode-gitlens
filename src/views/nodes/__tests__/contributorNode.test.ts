import '../../../container.js';
import * as assert from 'node:assert';
import * as sinon from 'sinon';
import { Uri } from 'vscode';
import { GitCommit, GitCommitIdentity } from '@gitlens/git/models/commit.js';
import { GitContributor } from '@gitlens/git/models/contributor.js';
import type { GitFile } from '@gitlens/git/models/file.js';
import type { GitLog } from '@gitlens/git/models/log.js';
import { GitUri } from '../../../git/gitUri.js';
import type { FilesQueryResults } from '../../../git/queryResults.js';
import type { ViewsWithContributors } from '../../viewBase.js';
import type { ViewNode } from '../abstract/viewNode.js';
import { CommitNode } from '../commitNode.js';
import { ContributorNode } from '../contributorNode.js';
import { ResultsFilesNode } from '../resultsFilesNode.js';

suite('ContributorNode comparison files', () => {
	let sandbox: sinon.SinonSandbox;
	let getLog: sinon.SinonStub;
	let view: ViewsWithContributors;
	let contributor: GitContributor;

	setup(async () => {
		sandbox = sinon.createSandbox();
		contributor = new GitContributor('/repo', 'Zoë', 'zoe@example.com', false, 4, undefined, undefined, undefined, {
			files: 99,
			additions: 100,
			deletions: 50,
			contributionScore: 1,
		});
		const identity = new GitCommitIdentity(contributor.name, contributor.email, new Date('2026-01-01'));
		const commit = new GitCommit('/repo', 'a'.repeat(40), identity, identity, 'Visible commit', []);
		const log: GitLog = {
			repoPath: '/repo',
			commits: new Map([[commit.sha, commit]]),
			count: 1,
			sha: undefined,
			limit: 20,
			hasMore: false,
		};
		getLog = sandbox.stub().resolves(log);
		const git = {
			getAbsoluteUri: (path: string) => Uri.file(path),
			getRepositoryService: () => ({
				commits: { getLog: getLog },
				getBranchesAndTagsTipsLookup: () => Promise.resolve(() => undefined),
			}),
		};
		const { Container } = await import('../../../container.js');
		sandbox.stub(Container, 'instance').get(() => ({ git: git }));
		view = {
			type: 'searchAndCompare',
			container: { git: git },
			config: { avatars: false, defaultItemLimit: 20, showRelativeDateMarkers: false },
			getNodeLastKnownLimit: () => undefined,
			nodeState: { getState: () => undefined },
		} as unknown as ViewsWithContributors;
	});

	teardown(() => {
		sandbox.restore();
	});

	function createNode(options?: ConstructorParameters<typeof ContributorNode>[4]): ContributorNode {
		return new ContributorNode(GitUri.fromRepoPath('/repo'), view, {} as ViewNode, contributor, options);
	}

	test('keeps ordinary contributors as a list of commits', async () => {
		const children = await createNode().getChildren();

		assert.strictEqual(children.length, 1);
		assert.ok(children[0] instanceof CommitNode);
		sinon.assert.calledOnce(getLog);
	});

	test('puts comparison files before commits and queries them only when needed', async () => {
		const files: GitFile[] = [{ path: 'src/current.ts', status: 'M' }];
		const query = sandbox
			.stub<[], Promise<FilesQueryResults>>()
			.resolves({ label: 'Comparison files', files: files });
		const node = createNode({ presence: undefined, files: { ref1: 'base', ref2: 'tip', query: query } });

		const children = await node.getChildren();

		assert.strictEqual(children.length, 2);
		const filesNode = children[0];
		assert.ok(filesNode instanceof ResultsFilesNode);
		assert.ok(children[1] instanceof CommitNode);
		sinon.assert.notCalled(query);
		sinon.assert.calledOnce(getLog);

		const comparison = await filesNode.getFilesComparison();
		assert.deepStrictEqual(comparison, { repoPath: '/repo', ref1: 'base', ref2: 'tip', files: files });
		assert.strictEqual(comparison.files[0], files[0]);
		assert.strictEqual(filesNode.filterable, true);

		const item = await filesNode.getTreeItem();
		assert.strictEqual(item.label, 'Comparison files');
		assert.strictEqual(item.description, undefined);
		sinon.assert.calledOnce(query);
	});

	(['ahead', 'behind'] as const).forEach(direction => {
		test(`preserves ${direction} comparison refs and direction`, async () => {
			const query = sandbox.stub<[], Promise<FilesQueryResults>>().resolves({ label: 'No files', files: [] });
			const node = createNode({
				presence: undefined,
				files: { ref1: 'base-sha', ref2: 'tip-sha', query: query, direction: direction },
			});

			const [filesNode] = await node.getChildren();

			assert.ok(filesNode instanceof ResultsFilesNode);
			assert.strictEqual(filesNode.ref1, 'base-sha');
			assert.strictEqual(filesNode.ref2, 'tip-sha');
			assert.strictEqual(filesNode.filterable, false);
			assert.ok(filesNode.id.includes(`/branch-status-direction/${direction}`));
			sinon.assert.notCalled(query);
		});
	});

	test('hides contributor statistics only when disabled', async () => {
		const visible = await createNode().getTreeItem();
		const hidden = await createNode({ presence: undefined, showStatistics: false }).getTreeItem();

		assert.ok(typeof visible.description === 'string');
		assert.ok(typeof hidden.description === 'string');
		assert.match(visible.description, /\+100/);
		assert.doesNotMatch(hidden.description, /99|100|50/);
		assert.ok(visible.tooltip != null && typeof visible.tooltip !== 'string');
		assert.ok(hidden.tooltip != null && typeof hidden.tooltip !== 'string');
		assert.match(visible.tooltip.value, /100/);
		assert.doesNotMatch(hidden.tooltip.value, /99|100|50/);
	});

	test('loads fresh commits and comparison files after a reset', async () => {
		const originalFiles: GitFile[] = [{ path: 'original.ts', status: 'M' }];
		const updatedFiles: GitFile[] = [{ path: 'updated.ts', status: 'A' }];
		const query = sandbox.stub<[], Promise<FilesQueryResults>>();
		query.onFirstCall().resolves({ label: 'Original files', files: originalFiles });
		query.onSecondCall().resolves({ label: 'Updated files', files: updatedFiles });
		const node = createNode({ presence: undefined, files: { ref1: 'base', ref2: 'tip', query: query } });
		const [original] = await node.getChildren();
		assert.ok(original instanceof ResultsFilesNode);
		assert.deepStrictEqual((await original.getFilesComparison()).files, originalFiles);

		node.refresh(true);
		const [updated] = await node.getChildren();

		assert.ok(updated instanceof ResultsFilesNode);
		assert.notStrictEqual(updated, original);
		assert.deepStrictEqual((await updated.getFilesComparison()).files, updatedFiles);
		sinon.assert.calledTwice(getLog);
		sinon.assert.calledTwice(query);
	});
});
