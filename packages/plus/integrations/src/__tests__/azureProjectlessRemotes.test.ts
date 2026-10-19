import assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import { createRemoteProviderMatcher } from '@gitlens/git/remotes/matcher.js';
import { parseGitRemoteUrl } from '@gitlens/git/utils/remote.utils.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { CacheController } from '@gitlens/utils/promiseCache.js';
import { toCloudIntegrationType } from '../authentication/models.js';
import { GitSelfManagedHostIntegrationId } from '../constants.js';
import { createIntegrationService } from '../integrationService.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import {
	azureWorkItemTypeStatesResponse,
	isAzureWorkItemTypeStatesUrl,
} from '../providers/azure/__tests__/fixtures.js';
import {
	getAzureScopeVirtualDirectory,
	isAzureProjectlessCandidate,
	resolveAzureProjectlessRepository,
} from '../providers/azureDevOps.js';
import { discoveryCacheTtl } from '../providers/utils/discoveryCache.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { watchRequestFailures } from './sweepHelpers.js';

/**
 * A repository named after its project is also served without the project segment, `{collection}/_git/{repo}`, which
 * TFS 2018 reports as its clone URL. Behind a virtual directory the remote parser reads `{vdir}/{collection}/_git/{repo}`
 * as collection `{vdir}` and project `{collection}`; the Azure DevOps Server integration settles it against the
 * collections it discovers. These tests drive the reads GitLens makes from a remote's descriptor against a server
 * answering at the HTTP level, which refuses a repository addressed by name without its project as Azure does.
 */

const id = GitSelfManagedHostIntegrationId.AzureDevOpsServer;
const sha = 'a'.repeat(40);

type Node = Record<string, unknown>;

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), { status: status, headers: { 'content-type': 'application/json' } });
}

/** Each collection holds two projects: `repo` with a repository named after it, and `proj` with repository `r`. */
const projects: Record<string, string> = { repo: 'repo', proj: 'r' };

function pullRequest(collectionUrl: string, project: string, repository: string): Node {
	const user = { id: 'author', displayName: 'Author', uniqueName: 'author@example.com', imageUrl: '' };
	return {
		repository: {
			id: `${project}-${repository}-id`,
			name: repository,
			project: { id: `${project}-id`, name: project },
		},
		pullRequestId: 7,
		codeReviewId: 7,
		status: 'active',
		createdBy: user,
		creationDate: '2026-01-02T03:04:05Z',
		title: `PR in ${project}`,
		description: '',
		sourceRefName: 'refs/heads/feature',
		targetRefName: 'refs/heads/main',
		mergeStatus: 'succeeded',
		isDraft: false,
		lastMergeSourceCommit: { commitId: sha },
		lastMergeTargetCommit: { commitId: 'b'.repeat(40) },
		reviewers: [],
		url: `${collectionUrl}/${project}-id/_apis/git/repositories/${project}-${repository}-id/pullRequests/7`,
	};
}

function workItem(collectionUrl: string, project: string): Node {
	return {
		id: 9,
		rev: 1,
		fields: {
			'System.TeamProject': project,
			'System.WorkItemType': 'Task',
			'System.State': 'To Do',
			'System.CreatedDate': '2026-01-01T00:00:00Z',
			'System.ChangedDate': '2026-01-02T00:00:00Z',
			'System.Title': `Work item in ${project}`,
		},
		_links: { html: { href: `${collectionUrl}/${project}/_workitems/edit/9` } },
		url: `${collectionUrl}/${project}-id/_apis/wit/workItems/9`,
	};
}

const workItemTypes = { count: 1, value: [{ name: 'Task' }] };

interface ServerOptions {
	/** Where the installation is served: `/tfs`, or `''` at the host root. */
	installation: string;
	/** The connection's address path; the installation when omitted. */
	connection?: string;
	/** The installation's collections. */
	collections?: string[];
	/** Answers `projectCollections` with this status... */
	failCollections?: number;
	/** ...for its first this many requests (every one when omitted). */
	failCollectionsTimes?: number;
	/** Holds every `projectCollections` answer after the failed ones until it settles. */
	holdCollections?: Promise<void>;
	/** Answers the server-level `connectionData` with this status. */
	failServerIdentity?: number;
	/** Answers a repository addressed by name without its project as missing rather than refused. */
	projectlessNotFound?: boolean;
	/** Refuses the credential for every request below this project. */
	refuseProject?: string;
	/** A project every collection holds, with repository `repo` and no pull requests or work items. */
	emptyProject?: string;
	/**
	 * Answers a list or query below a collection that names no project rather than refusing it: with nothing, as
	 * Azure DevOps Server 2020 answers a work item query without a project context, or with project `repo`'s rows.
	 */
	projectless?: 'empty' | 'rows';
	/** Serves a request below the installation that names no collection as its first collection, the default one. */
	defaultCollectionAtServer?: boolean;
}

function createServer(options: ServerOptions) {
	const runtime = createFakeRuntime();
	// The point reads go through the host's cache, which these tests don't keep.
	const uncached = new CacheController();
	runtime.cache.getPullRequest = (_id, _resource, _integration, loader) => loader(uncached).value;
	runtime.cache.getPullRequestForBranch = (_branch, _repo, _integration, loader) => loader(uncached).value;
	runtime.cache.getPullRequestForSha = (_sha, _repo, _integration, loader) => loader(uncached).value;
	runtime.cache.getIssueOrPullRequest = (_id, _type, _resource, _integration, loader) => loader(uncached).value;
	runtime.cache.getRepositoryDefaultBranch = (_repo, _integration, loader) => loader(uncached).value;
	runtime.cache.getRepositoryMetadata = (_repo, _integration, loader) => loader(uncached).value;

	const collections = options.collections ?? ['DefaultCollection'];
	const address = `https://server.test${options.connection ?? options.installation}`;
	const descriptor = { tokenId: 'connection', provider: toCloudIntegrationType[id], type: 'pat', domain: address };
	runtime.account.getAccount = async () => ({ id: 'me' });
	runtime.account.fetchGkApi = async path => {
		if (path === 'v1/provider-tokens') return json({ data: [{ ...descriptor, secondaries: [] }] });

		return json({ data: { ...descriptor, accessToken: 'me-token', expiresIn: 3600, scopes: '' } });
	};

	const requests: string[] = [];
	let collectionReads = 0;
	runtime.http.fetch = async input => {
		const url = new URL(input.toString());
		requests.push(url.pathname);
		if (!url.pathname.startsWith(`${options.installation}/`)) return json({ message: 'Page not found.' }, 404);

		const segments = url.pathname
			.slice(options.installation.length + 1)
			.split('/')
			.map(decodeURIComponent);
		const atServer = segments[0] === '_apis';
		const route = (atServer ? segments : segments.slice(1)).join('/').toLowerCase();
		if (route === '_apis/connectiondata') {
			if (atServer && options.failServerIdentity != null) {
				return json({ message: 'boom' }, options.failServerIdentity);
			}

			const user = { id: 'me', providerDisplayName: 'me', properties: { Account: { $value: 'me@example.com' } } };
			return json({
				authenticatedUser: user,
				authorizedUser: user,
				instanceId: atServer ? 'server-id' : `${segments[0]}-id`,
				webApplicationRelativeDirectory: atServer ? null : `${options.installation}/${segments[0]}/`,
			});
		}
		if (route === '_apis/projectcollections') {
			collectionReads++;
			if (
				options.failCollections != null &&
				(options.failCollectionsTimes == null || collectionReads <= options.failCollectionsTimes)
			) {
				return json({ message: 'refused' }, options.failCollections);
			}

			if (!atServer) return json({ message: 'Page not found.' }, 404);

			await options.holdCollections;
			return json({ value: collections.map(c => ({ id: `${c}-id`, name: c, url: '' })) });
		}

		if (atServer && options.defaultCollectionAtServer) {
			segments.unshift(collections[0]);
		}
		const collection = collections.find(c => c === segments[0]);
		if (collection == null) return json({ message: 'unknown collection' }, 404);
		if (isAzureWorkItemTypeStatesUrl(url)) return azureWorkItemTypeStatesResponse(url)!;

		const collectionUrl = `https://server.test${options.installation}/${collection}`;
		const [projectSegment, ...rest] = segments.slice(1);
		// Follow-up reads address the project and repository by the ids a pull request carries.
		const project = projectSegment.replace(/-id$/, '');
		if (projectSegment === '_apis' && rest.join('/').toLowerCase() === 'projects') {
			const names = [...Object.keys(projects), ...(options.emptyProject != null ? [options.emptyProject] : [])];
			return json({ count: names.length, value: names.map(n => ({ id: `${n}-id`, name: n })) });
		}
		if (options.projectless != null && projectSegment === '_apis') {
			const rows = options.projectless === 'rows';
			const path = rest.join('/').toLowerCase();
			if (path.endsWith('/pullrequests')) {
				return json({ value: rows ? [pullRequest(collectionUrl, 'repo', 'repo')] : [] });
			}
			if (path === 'wit/workitems' || path === 'wit/workitemsbatch') {
				return json({ value: rows ? [workItem(collectionUrl, 'repo')] : [] });
			}
			if (path === 'wit/wiql') return json({ workItems: rows ? [{ id: 9 }] : [] });
			if (path === 'wit/workitemtypes') return json(workItemTypes);
		}
		if (projectSegment === '_apis' && rest[0] === 'git' && rest[1] === 'repositories' && rest.length >= 3) {
			return options.projectlessNotFound
				? json({ typeKey: 'GitRepositoryNotFoundException', message: 'not found' }, 404)
				: json({ message: 'A project name is required in order to reference a Git repository by name.' }, 400);
		}

		if (project === options.emptyProject) {
			const path = rest.join('/').toLowerCase();
			switch (true) {
				case path === '_apis/git/repositories/repo':
					return json({
						id: `${project}-repo-id`,
						name: 'repo',
						project: { id: `${project}-id`, name: project },
						defaultBranch: 'refs/heads/main',
						remoteUrl: `${collectionUrl}/${project}/_git/repo`,
						webUrl: `${collectionUrl}/${project}/_git/repo`,
					});
				case path.endsWith('/pullrequests'):
				case path === '_apis/wit/workitems':
					return json({ count: 0, value: [] });
				case path === '_apis/wit/wiql':
					return json({ workItems: [] });
				case path === '_apis/wit/workitemtypes':
					return json(workItemTypes);
				default:
					return json({ message: `unhandled ${url.pathname}` }, 404);
			}
		}

		const repository = projects[project];
		if (repository == null) return json({ message: 'unknown project' }, 404);
		if (project === options.refuseProject) return json({ message: 'Access denied.' }, 403);

		const path = rest
			.join('/')
			.replace(`repositories/${project}-${repository}-id`, `repositories/${repository}`)
			.toLowerCase();
		const repo = `_apis/git/repositories/${repository.toLowerCase()}`;
		switch (true) {
			case path === repo:
				return json({
					id: `${project}-${repository}-id`,
					name: repository,
					project: { id: `${project}-id`, name: project },
					defaultBranch: 'refs/heads/main',
					remoteUrl: `${collectionUrl}/${project}/_git/${repository}`,
					webUrl: `${collectionUrl}/${project}/_git/${repository}`,
				});
			case path === `${repo}/pullrequests`:
				return json({ value: [pullRequest(collectionUrl, project, repository)] });
			case path === `${repo}/pullrequestquery`:
				return json({ results: [{ [sha]: [pullRequest(collectionUrl, project, repository)] }] });
			case path === `${repo}/pullrequests/7`:
			case path === '_apis/git/pullrequests/7':
				return json(pullRequest(collectionUrl, project, repository));
			case path === '_apis/wit/workitems/9':
				return json(workItem(collectionUrl, project));
			case path === '_apis/wit/workitems':
			case path === '_apis/wit/workitemsbatch':
				return json({ value: [workItem(collectionUrl, project)] });
			case path === '_apis/wit/wiql':
				return json({ workItems: [{ id: 9 }] });
			case path === '_apis/wit/workitemtypes':
				return json(workItemTypes);
			case path === `${repo}/commits/${sha}`:
				return json({ commitId: sha, author: { name: 'Author', email: 'author@example.com' } });
			default:
				return json({ message: `unhandled ${url.pathname}` }, 404);
		}
	};

	return {
		runtime: runtime,
		requests: requests,
		/** The requests below a collection that address a repository by name without its project. */
		projectlessRequests: (paths = requests) =>
			paths.filter(p => /^\/[^/]+\/_apis\/git\/repositories\//i.test(p.slice(options.installation.length))),
		collectionReads: () => requests.filter(p => p.toLowerCase().endsWith('/_apis/projectcollections')).length,
	};
}

/** The descriptor GitLens reads a remote's repository with, as the remote parser builds it. */
function descriptorFor(remoteUrl: string) {
	const [scheme, domain, path] = parseGitRemoteUrl(remoteUrl);
	const provider = createRemoteProviderMatcher([{ domain: 'server.test', type: 'azure-devops' }])(
		remoteUrl,
		domain,
		path,
		scheme,
	);
	assert.ok(provider != null, remoteUrl);
	return { ...provider.repoDesc, key: remoteUrl };
}

async function connect(server: ReturnType<typeof createServer>) {
	const manager = createIntegrationService(server.runtime);
	await manager.refreshConnections();
	const [connection] = manager.getConfigured(id);
	const azure = (await manager.get(id, connection.domain)) as GitHostIntegration;
	// The connect-time discovery runs detached; let it settle so only the reads' own requests are counted.
	await new Promise(resolve => setTimeout(resolve, 0));
	return { manager: manager, azure: azure };
}

/** The repository reads GitLens makes from a remote, each with the request path it must reach. */
async function assertReads(
	azure: GitHostIntegration,
	server: ReturnType<typeof createServer>,
	remoteUrl: string,
	repoPath: string,
): Promise<void> {
	const repo = descriptorFor(remoteUrl);
	const count = server.requests.length;

	const forBranch = await azure.getPullRequestForBranch(repo, 'feature', { throwOnError: true });
	assert.equal(forBranch?.id, '7', `${remoteUrl}: PR for branch`);
	const forCommit = await azure.getPullRequestForCommit(repo, sha, { throwOnError: true });
	assert.equal(forCommit?.id, '7', `${remoteUrl}: PR for commit`);
	const byNumber = await azure.getPullRequest(repo, '7', { throwOnError: true });
	assert.equal(byNumber?.id, '7', `${remoteUrl}: PR by number`);
	const linked = await azure.getLinkedIssueOrPullRequest(repo, { id: '7', key: '7' }, { type: 'pullrequest' });
	assert.equal((linked as PullRequest | undefined)?.id, '7', `${remoteUrl}: linked PR`);
	const author = await azure.getAccountForCommit(repo, sha);
	assert.equal(author?.email, 'author@example.com', `${remoteUrl}: commit author`);
	const defaultBranch = await azure.getDefaultBranch(repo);
	assert.equal(defaultBranch?.name, 'main', `${remoteUrl}: default branch`);

	const paths = server.requests.slice(count);
	for (const suffix of ['/pullRequests', '/pullrequestquery', `/commits/${sha}`, '']) {
		assert.ok(
			paths.some(p => p === `${repoPath}${suffix}`),
			`${remoteUrl}: expected ${repoPath}${suffix} in ${paths.join(', ')}`,
		);
	}
	assert.deepEqual(server.projectlessRequests(paths), [], `${remoteUrl}: no repository read without its project`);
}

suite('Azure DevOps Server remotes of repositories named after their project', () => {
	suite('resolveAzureProjectlessRepository', () => {
		const repo = {
			owner: 'tfs',
			name: 'DefaultCollection/_git/R',
			virtualDirectory: undefined,
			project: undefined,
		};
		for (const { label, input, collections, expected } of [
			{
				label: 'reads the collection behind one virtual directory',
				input: repo,
				collections: ['DefaultCollection'],
				expected: { owner: 'DefaultCollection', name: 'R/_git/R', project: 'R', virtualDirectory: 'tfs' },
			},
			{
				label: 'reads the collection behind nested virtual directories',
				input: { ...repo, owner: 'team', virtualDirectory: 'tfs' },
				collections: ['DefaultCollection'],
				expected: { owner: 'DefaultCollection', name: 'R/_git/R', project: 'R', virtualDirectory: 'tfs/team' },
			},
			{
				label: 'spells the collection as discovered',
				input: { ...repo, name: 'defaultcollection/_git/R' },
				collections: ['DefaultCollection'],
				expected: { owner: 'DefaultCollection', name: 'R/_git/R', project: 'R', virtualDirectory: 'tfs' },
			},
			{
				label: 'replaces a project read from the path',
				input: { ...repo, project: 'DefaultCollection' },
				collections: ['DefaultCollection'],
				expected: { owner: 'DefaultCollection', name: 'R/_git/R', project: 'R', virtualDirectory: 'tfs' },
			},
			{
				label: 'keeps a full path whose owner is a collection',
				input: { ...repo, owner: 'DefaultCollection', name: 'Foo/_git/R' },
				collections: ['DefaultCollection', 'Foo'],
				expected: undefined,
			},
			{ label: 'keeps a path naming no collection', input: repo, collections: ['Other'], expected: undefined },
			{ label: 'keeps a path when no collection is known', input: repo, collections: [], expected: undefined },
			{
				label: 'keeps a bare name',
				input: { ...repo, name: 'DefaultCollection' },
				collections: ['DefaultCollection'],
				expected: undefined,
			},
		]) {
			test(label, () => {
				assert.deepEqual(
					resolveAzureProjectlessRepository(input, collections),
					expected == null ? input : { ...input, ...expected },
				);
			});
		}
	});

	suite('isAzureProjectlessCandidate', () => {
		const shortBehindTfs = { owner: 'tfs', name: 'DefaultCollection/_git/R' };
		const cases: { address: string; repo: Parameters<typeof isAzureProjectlessCandidate>[1]; expected: boolean }[] =
			[
				{ address: 'https://h/tfs', repo: shortBehindTfs, expected: true },
				{ address: 'https://h/TFS/', repo: shortBehindTfs, expected: true },
				{ address: 'https://h/tfs/DefaultCollection', repo: shortBehindTfs, expected: true },
				{ address: 'https://h/%74fs', repo: shortBehindTfs, expected: true },
				{ address: 'https://h', repo: shortBehindTfs, expected: false },
				{ address: 'https://h/other', repo: shortBehindTfs, expected: false },
				{
					address: 'https://h/tfs/team',
					repo: { owner: 'team', name: 'DefaultCollection/_git/R', virtualDirectory: 'tfs' },
					expected: true,
				},
				{
					address: 'https://h/tfs',
					repo: { owner: 'DefaultCollection', name: 'proj/_git/r', virtualDirectory: 'tfs' },
					expected: false,
				},
				{ address: 'https://h/tfs', repo: { owner: 'tfs', name: 'DefaultCollection' }, expected: false },
			];
		for (const { address, repo, expected } of cases) {
			test(`${expected ? 'settles' : 'reads as parsed'} ${repo.virtualDirectory ?? ''}/${repo.owner}/${repo.name} below ${address}`, () => {
				assert.equal(isAzureProjectlessCandidate(address, repo), expected);
			});
		}
	});

	suite('getAzureScopeVirtualDirectory', () => {
		for (const [address, owner, expected] of [
			['https://h', 'tfs', undefined],
			['https://h/', 'tfs', undefined],
			['https://h/tfs', 'tfs', ''],
			['https://h/TFS/', 'tfs', ''],
			['https://h/%74fs', 'tfs', ''],
			['https://h/tfs/DefaultCollection', 'DefaultCollection', 'tfs'],
			['https://h/tfs/DefaultCollection', 'tfs', ''],
			['https://h/a%20b/tfs', 'tfs', 'a b'],
			['https://h/x/x', 'x', 'x'],
			['https://h/tfs', 'other', undefined],
		] as const) {
			test(`places ${owner} below ${address}`, () => {
				assert.equal(getAzureScopeVirtualDirectory(address, owner), expected);
			});
		}
	});

	suite('reads', () => {
		for (const connection of ['/tfs', '/tfs/DefaultCollection']) {
			for (const remoteUrl of [
				'https://server.test/tfs/DefaultCollection/_git/repo',
				'ssh://server.test:22/tfs/DefaultCollection/_git/repo',
			]) {
				test(`reach the project behind a virtual directory for ${remoteUrl} (connection ${connection})`, async () => {
					const server = createServer({ installation: '/tfs', connection: connection });
					const { manager, azure } = await connect(server);
					try {
						await assertReads(
							azure,
							server,
							remoteUrl,
							'/tfs/DefaultCollection/repo/_apis/git/repositories/repo',
						);
					} finally {
						manager.dispose();
					}
				});
			}
		}

		for (const remoteUrl of [
			'https://server.test/DefaultCollection/_git/repo',
			'ssh://server.test:22/DefaultCollection/_git/repo',
		]) {
			test(`reach the project at the host root without discovery for ${remoteUrl}`, async () => {
				const server = createServer({ installation: '' });
				const { manager, azure } = await connect(server);
				try {
					const discovered = server.collectionReads();
					await assertReads(azure, server, remoteUrl, '/DefaultCollection/repo/_apis/git/repositories/repo');
					assert.equal(server.collectionReads(), discovered);
				} finally {
					manager.dispose();
				}
			});
		}

		// A consumer that parses the remote itself names the scope as the remote parser does: collection `tfs`, project
		// `DefaultCollection`.
		for (const connection of ['/tfs', '/tfs/DefaultCollection']) {
			test(`reach the project for a caller's project-less scope behind a virtual directory (connection ${connection})`, async () => {
				const server = createServer({ installation: '/tfs', connection: connection });
				const { manager, azure } = await connect(server);
				try {
					const repo = { namespace: 'tfs', project: 'DefaultCollection', name: 'repo' };
					const target = { owner: 'tfs', project: 'DefaultCollection', repo: 'repo' };
					const count = server.requests.length;

					const listed = await azure.getMyPullRequestsForReposResult([repo]);
					assert.deepEqual(
						listed?.value?.values.map(pr => pr.id),
						['7'],
						String(listed?.error),
					);
					const batch = await azure.getPullRequestsBatchResult([{ ...target, number: 7 }]);
					const [slot] = batch?.value ?? [];
					assert.equal(slot?.status === 'fulfilled' ? slot.value?.id : slot, '7');
					const etags = await azure.getPullRequestsEtagFieldsResult([{ ...target, number: 7 }], {});
					const [etag] = etags?.value ?? [];
					assert.equal(etag?.status, 'fulfilled', String(etags?.error));
					const issues = await azure.getIssuesBatchResult([{ ...target, number: 9 }]);
					const [issue] = issues?.value ?? [];
					assert.equal(issue?.status === 'fulfilled' ? issue.value?.id : issue, '9', String(issues?.error));
					const issueEtags = await azure.getIssuesEtagFieldsResult([{ ...target, number: 9 }], {});
					const [issueEtag] = issueEtags?.value ?? [];
					assert.equal(issueEtag?.status, 'fulfilled', String(issueEtags?.error));
					const forBranches = await azure.getPullRequestsForBranchesResult(
						[{ ...target, branch: 'feature' }],
						{
							limit: 5,
						},
					);
					const [branch] = forBranches?.value ?? [];
					assert.deepEqual(
						branch?.status === 'fulfilled' ? branch.value.pullRequests.map(pr => pr.id) : branch,
						['7'],
					);

					const paths = server.requests.slice(count);
					assert.ok(
						paths.some(p => p.startsWith('/tfs/DefaultCollection/repo/_apis/git/repositories/repo/')),
						paths.join(', '),
					);
					// The clone URLs a list asks for address the repository by its id, which needs no project.
					assert.deepEqual(
						server.projectlessRequests(paths).filter(p => !p.endsWith('-id')),
						[],
					);
				} finally {
					manager.dispose();
				}
			});
		}

		test("rejects what a caller's scope read nothing for while its collection can't be settled", async () => {
			const server = createServer({ installation: '/tfs', failCollections: 500, projectlessNotFound: true });
			const { manager, azure } = await connect(server);
			try {
				const target = { owner: 'tfs', project: 'DefaultCollection', repo: 'repo' };
				const batch = await azure.getPullRequestsBatchResult([{ ...target, number: 7 }]);
				// Every slot failed, so the call fails: neither is a proven absence.
				assert.ok(batch?.error != null && batch.value == null, 'not a proven absence');
				const forBranches = await azure.getPullRequestsForBranchesResult([{ ...target, branch: 'feature' }], {
					limit: 5,
				});
				assert.ok(forBranches?.error != null && forBranches.value == null, 'not a proven absence');

				// A scope that names its collection reads as given, without the collections.
				const full = await azure.getPullRequestsBatchResult([
					{ owner: 'DefaultCollection', project: 'proj', repo: 'r', number: 7 },
				]);
				const [slot] = full?.value ?? [];
				assert.equal(slot?.status === 'fulfilled' ? slot.value?.id : slot, '7', String(full?.error));
			} finally {
				manager.dispose();
			}
		});

		test("reports what a caller's scope listed nothing for while its collection can't be settled", async () => {
			// The same scope against the same answers, once with the collections failing and once listing them. A read
			// of the scope reaches the default collection without a project, which answers a work item query with
			// nothing (as Azure DevOps Server 2020 does); here a pull request list too. Only the miss of a scope that
			// couldn't be settled proves nothing. The searches and counts re-read the collections themselves, and
			// once those list `tfs` the scope reads as settling would read it, so their empty answer is complete.
			for (const failing of [true, false]) {
				const server = createServer({
					installation: '/tfs',
					collections: ['DefaultCollection', 'tfs'],
					...(failing ? { failCollections: 500, failCollectionsTimes: 2 } : {}),
					emptyProject: 'DefaultCollection',
					projectless: 'empty',
					defaultCollectionAtServer: true,
				});
				const { manager } = await connect(server);
				try {
					const [connection] = manager.getConfigured(id);
					const target = { providerId: id, connectionId: connection.id, domain: connection.domain };
					const repos = [{ namespace: 'tfs', project: 'DefaultCollection', name: 'repo' }];

					const lists = {
						listPullRequests: await manager.listPullRequestsPage({ ...target, repos: [...repos] }),
						listIssues: await manager.listIssuesPage({ ...target, repos: [...repos] }),
					};
					const searches = {
						searchPullRequests: await manager.searchPullRequestsPage({ ...target, repos: [...repos] }),
						searchIssues: await manager.searchIssuesPage({ ...target, repos: [...repos] }),
					};
					for (const [read, result] of Object.entries({ ...lists, ...searches })) {
						const flagged = failing && read in lists;
						const label = `failing=${failing} ${read}: ${JSON.stringify(result.warnings)}`;
						assert.deepEqual(result.items, [], label);
						assert.equal(Boolean(result.fetchFailed || result.page.truncated), flagged, label);
						const scope =
							read === 'listIssues' ? 'resource tfs, project DefaultCollection' : 'repository tfs/repo';
						assert.deepEqual(
							result.warnings.map(w => w.message),
							flagged
								? [
										`Failed to read provider scope (${scope}): Nothing read for a repository that couldn't be settled`,
									]
								: [],
							label,
						);
					}

					const counts = {
						countIssues: await manager.countIssues({
							...target,
							scopes: [{ key: 's', repos: [...repos] }],
						}),
						countPullRequests: await manager.countPullRequests({
							...target,
							scopes: [{ key: 's', repos: [...repos] }],
						}),
					};
					for (const [read, result] of Object.entries(counts)) {
						const label = `failing=${failing} ${read}: ${JSON.stringify(result)}`;
						assert.equal(result.items[0]?.count, 0, label);
						assert.deepEqual(result.warnings, [], label);
					}
				} finally {
					manager.dispose();
				}
			}
		});

		test("doesn't report a caller's scope that can't be settled once it lists something", async () => {
			const server = createServer({ installation: '/tfs', failCollections: 500, projectless: 'rows' });
			const { manager } = await connect(server);
			try {
				const [connection] = manager.getConfigured(id);
				const target = { providerId: id, connectionId: connection.id, domain: connection.domain };
				const repos = [{ namespace: 'tfs', project: 'DefaultCollection', name: 'repo' }];
				const reads = {
					listPullRequests: await manager.listPullRequestsPage({ ...target, repos: [...repos] }),
					listIssues: await manager.listIssuesPage({ ...target, repos: [...repos] }),
				};
				for (const [read, result] of Object.entries(reads)) {
					const label = `${read}: ${JSON.stringify(result.warnings)}`;
					assert.equal(result.items.length, 1, label);
					assert.ok(!result.fetchFailed && !result.page.truncated, label);
					assert.deepEqual(result.warnings, [], label);
				}
			} finally {
				manager.dispose();
			}
		});

		test("keeps what the other scopes listed beside a caller's scope that can't be settled", async () => {
			const server = createServer({ installation: '/tfs', failCollections: 500, projectless: 'empty' });
			const { manager } = await connect(server);
			try {
				const [connection] = manager.getConfigured(id);
				const listed = await manager.listPullRequestsPage({
					providerId: id,
					connectionId: connection.id,
					domain: connection.domain,
					repos: [
						{ namespace: 'tfs', project: 'DefaultCollection', name: 'repo' },
						{ namespace: 'DefaultCollection', project: 'proj', name: 'r' },
					],
				});
				const label = JSON.stringify(listed.warnings);
				assert.deepEqual(
					listed.items.map(pr => pr.title),
					['PR in proj'],
					label,
				);
				assert.ok(listed.fetchFailed || listed.page.truncated, label);
				assert.deepEqual(
					listed.warnings.map(w => w.message),
					[
						"Failed to read provider scope (repository tfs/repo): Nothing read for a repository that couldn't be settled",
					],
				);
			} finally {
				manager.dispose();
			}
		});

		test("keeps an unsettled project's empty list incomplete beside a project with issues", async () => {
			const server = createServer({
				installation: '/tfs',
				connection: '/tfs/tfs',
				collections: ['DefaultCollection', 'tfs'],
				failCollections: 500,
				emptyProject: 'DefaultCollection',
			});
			const { manager } = await connect(server);
			try {
				const [connection] = manager.getConfigured(id);
				const listed = await manager.listIssuesPage({
					providerId: id,
					connectionId: connection.id,
					domain: connection.domain,
					repos: [
						{ namespace: 'tfs', project: 'DefaultCollection', name: 'repo' },
						{ namespace: 'tfs', project: 'proj', name: 'r' },
					],
				});
				assert.deepEqual(
					listed.items.map(issue => issue.title),
					['Work item in proj'],
					JSON.stringify(listed.warnings),
				);
				assert.equal(listed.fetchFailed, true);
				assert.equal(listed.page.truncated, true);
				assert.equal(listed.hasMore, false);
				assert.deepEqual(
					listed.warnings.map(w => w.message),
					[
						"Failed to read provider scope (resource tfs, project DefaultCollection): Nothing read for a repository that couldn't be settled",
					],
				);
			} finally {
				manager.dispose();
			}
		});

		for (const recoverDiscovery of [false, true]) {
			test(`refuses mixed search scopes after collection discovery ${recoverDiscovery ? 'recovers' : 'keeps failing'}`, async () => {
				const server = createServer({
					installation: '/tfs',
					collections: ['tfs'],
					failCollections: 500,
					...(recoverDiscovery ? { failCollectionsTimes: 2 } : {}),
					defaultCollectionAtServer: true,
					projectless: 'rows',
				});
				const { manager } = await connect(server);
				try {
					const [connection] = manager.getConfigured(id);
					const target = { providerId: id, connectionId: connection.id, domain: connection.domain };
					const repos = [
						{ namespace: 'tfs', project: 'DefaultCollection', name: 'repo' },
						{ namespace: 'tfs', project: 'proj', name: 'r' },
					];
					const searches = {
						issues: await manager.searchIssuesPage({ ...target, repos: repos }),
						pullRequests: await manager.searchPullRequestsPage({ ...target, repos: repos }),
					};
					for (const [read, result] of Object.entries(searches)) {
						assert.deepEqual(result.items, [], read);
						assert.equal(result.fetchFailed, true, read);
						assert.ok(result.warnings.length > 0, read);
						if (recoverDiscovery) {
							assert.match(
								result.warnings[0].message,
								/project 'DefaultCollection' is not visible in 'tfs'/,
								read,
							);
						}
					}

					const counts = {
						issues: await manager.countIssues({ ...target, scopes: [{ key: 'mixed', repos: repos }] }),
						pullRequests: await manager.countPullRequests({
							...target,
							scopes: [{ key: 'mixed', repos: repos }],
						}),
					};
					for (const [read, result] of Object.entries(counts)) {
						assert.deepEqual(result.items, [], read);
						assert.equal(result.fetchFailed, true, read);
						assert.ok(result.warnings.length > 0, read);
					}
					assert.ok(
						!server.requests.some(p => /\/(?:wiql|pullrequests)$/i.test(p)),
						server.requests.join(', '),
					);
				} finally {
					manager.dispose();
				}
			});
		}

		test("records a refusal of a caller's scope against the repository it settles to", async () => {
			const server = createServer({ installation: '/tfs', refuseProject: 'repo' });
			const { manager, azure } = await connect(server);
			try {
				const settledScope = { providerId: id, resourceId: 'DefaultCollection', projectId: 'repo' };
				const batch = await azure.getPullRequestsBatchResult([
					{ owner: 'DefaultCollection', project: 'proj', repo: 'r', number: 7 },
					{ owner: 'tfs', project: 'DefaultCollection', repo: 'repo', number: 7 },
				]);
				const [, refused] = batch?.value ?? [];
				assert.deepEqual(
					refused?.status === 'rejected' ? refused.failure?.scope : refused,
					settledScope,
					String(batch?.error),
				);

				const [configured] = manager.getConfigured(id);
				const resolved = await manager.resolveRepository({
					providerId: id,
					connectionId: configured.id,
					domain: configured.domain,
					remoteUrl: 'https://server.test/tfs/DefaultCollection/_git/repo',
				});
				assert.equal(resolved.resolution.status, 'unauthorized', JSON.stringify(resolved));
				const { resourceId, projectId } = resolved.resolution.warning?.scope ?? {};
				assert.deepEqual(
					{ resourceId: resourceId, projectId: projectId },
					{ resourceId: 'DefaultCollection', projectId: 'repo' },
					JSON.stringify(resolved.resolution.warning),
				);
			} finally {
				manager.dispose();
			}
		});

		test("reads a caller's scope as given when it settles to a repository the connection doesn't serve", async () => {
			// `x/DefaultCollection/_git/repo` would be collection `DefaultCollection` of an installation at `/x`, not of
			// this one at `/x/tfs`: settling it here would read this installation's unrelated `DefaultCollection/repo`.
			const server = createServer({ installation: '/x/tfs' });
			const { manager, azure } = await connect(server);
			try {
				const count = server.requests.length;
				const batch = await azure.getPullRequestsBatchResult([
					{ owner: 'DefaultCollection', project: 'proj', repo: 'r', number: 7 },
					{ owner: 'x', project: 'DefaultCollection', repo: 'repo', number: 7 },
				]);
				assert.equal(batch?.error, undefined, String(batch?.error));
				const [, slot] = batch?.value ?? [];
				assert.equal(slot?.status, 'rejected', 'read as given, below a collection this installation lacks');
				const paths = server.requests.slice(count);
				assert.ok(!paths.some(p => p.startsWith('/x/tfs/DefaultCollection/repo/')), paths.join(', '));
				assert.ok(
					paths.some(p => p.startsWith('/x/tfs/x/DefaultCollection/')),
					paths.join(', '),
				);
			} finally {
				manager.dispose();
			}
		});

		test("reads a caller's scope as given when its owner can't address the connection's installation", async () => {
			// The owner matches a segment ahead of the addressed collection, so it reads as a candidate whose virtual
			// directory the connection can't serve; settling it must leave it as given rather than fail the read.
			const server = createServer({
				installation: '/x/tfs',
				connection: '/x/tfs/DefaultCollection',
				collections: ['DefaultCollection', 'tfs'],
			});
			const { manager, azure } = await connect(server);
			try {
				const batch = await azure.getPullRequestsBatchResult([
					{ owner: 'DefaultCollection', project: 'proj', repo: 'r', number: 7 },
					{ owner: 'tfs', project: 'proj', repo: 'r', number: 7 },
				]);
				assert.equal(batch?.error, undefined, String(batch?.error));
				const [slot] = batch?.value ?? [];
				assert.equal(slot?.status === 'fulfilled' ? slot.value?.id : slot, '7');
			} finally {
				manager.dispose();
			}
		});

		for (const collections of [['DefaultCollection'], ['DefaultCollection', 'proj']]) {
			test(`keep a full path as parsed (collections ${collections.join(', ')})`, async () => {
				const server = createServer({ installation: '/tfs', collections: collections });
				const { manager, azure } = await connect(server);
				try {
					for (const remoteUrl of [
						'https://server.test/tfs/DefaultCollection/proj/_git/r',
						'ssh://server.test:22/tfs/DefaultCollection/proj/_git/r',
						'https://server.test/tfs/DefaultCollection/repo/_git/repo',
					]) {
						const project = remoteUrl.includes('/proj/') ? 'proj' : 'repo';
						await assertReads(
							azure,
							server,
							remoteUrl,
							`/tfs/DefaultCollection/${project}/_apis/git/repositories/${projects[project]}`,
						);
					}
				} finally {
					manager.dispose();
				}
			});
		}
	});

	suite('resolveRepository', () => {
		for (const connection of ['/tfs', '/tfs/DefaultCollection']) {
			for (const remoteUrl of [
				'https://server.test/tfs/DefaultCollection/_git/repo',
				'ssh://server.test:22/tfs/DefaultCollection/_git/repo',
			]) {
				test(`identifies the repository for ${remoteUrl} (connection ${connection})`, async () => {
					const server = createServer({ installation: '/tfs', connection: connection });
					const { manager } = await connect(server);
					try {
						const [configured] = manager.getConfigured(id);
						const count = server.requests.length;
						const result = await manager.resolveRepository({
							providerId: id,
							connectionId: configured.id,
							domain: configured.domain,
							remoteUrl: remoteUrl,
						});
						assert.equal(result.resolution.status, 'resolved', JSON.stringify(result));
						assert.equal(result.resolution.identity?.owner, 'DefaultCollection');
						assert.equal(result.resolution.identity?.project, 'repo');
						assert.equal(result.resolution.identity?.name, 'repo');
						assert.ok(
							server.requests
								.slice(count)
								.includes('/tfs/DefaultCollection/repo/_apis/git/repositories/repo'),
							server.requests.slice(count).join(', '),
						);
					} finally {
						manager.dispose();
					}
				});
			}
		}

		test('keeps a full path identified as parsed', async () => {
			const server = createServer({ installation: '/tfs', collections: ['DefaultCollection', 'proj'] });
			const { manager } = await connect(server);
			try {
				const [configured] = manager.getConfigured(id);
				for (const remoteUrl of [
					'https://server.test/tfs/DefaultCollection/proj/_git/r',
					'ssh://server.test:22/tfs/DefaultCollection/proj/_git/r',
				]) {
					const result = await manager.resolveRepository({
						providerId: id,
						connectionId: configured.id,
						domain: configured.domain,
						remoteUrl: remoteUrl,
					});
					assert.equal(result.resolution.identity?.owner, 'DefaultCollection', remoteUrl);
					assert.equal(result.resolution.identity?.project, 'proj', remoteUrl);
					assert.equal(result.resolution.identity?.name, 'r', remoteUrl);
				}
			} finally {
				manager.dispose();
			}
		});
	});

	suite('collection discovery', () => {
		const shortRemote = 'https://server.test/tfs/DefaultCollection/_git/repo';
		const fullRemote = 'https://server.test/tfs/DefaultCollection/proj/_git/r';

		for (const status of [401, 403, 500]) {
			test(`a refused discovery (${status}) leaves the remote as parsed and the connection working`, async () => {
				const server = createServer({ installation: '/tfs', failCollections: status });
				const { manager, azure } = await connect(server);
				try {
					const forShort = await azure.getPullRequestForBranch(descriptorFor(shortRemote), 'feature');
					assert.equal(forShort, undefined);
					assert.deepEqual(server.projectlessRequests(), [
						'/tfs/DefaultCollection/_apis/git/repositories/repo/pullRequests',
					]);
					assert.ok(azure.maybeConnected !== false, 'the session is not expired by discovery');
					await assertReads(
						azure,
						server,
						fullRemote,
						'/tfs/DefaultCollection/proj/_apis/git/repositories/r',
					);
				} finally {
					manager.dispose();
				}
			});
		}

		for (const [status, kept] of [
			[500, false],
			[401, true],
		] as const) {
			test(`a read a discovery ${status} left unsettled ${kept ? 'caches' : 'keeps out of the caches'} its miss`, async () => {
				const server = createServer({ installation: '/tfs', failCollections: status });
				const reads: { read: string; cacheable: CacheController }[] = [];
				const invalidated = () => reads.filter(r => r.cacheable.invalidated).map(r => r.read);
				const track = <V>(read: string, loader: (c: CacheController) => { value: V }): V => {
					const cacheable = new CacheController();
					reads.push({ read: read, cacheable: cacheable });
					return loader(cacheable).value;
				};
				server.runtime.cache.getPullRequestForBranch = (branch, _repo, _integration, loader) =>
					track(branch, loader);
				server.runtime.cache.getPullRequestForSha = (_sha, _repo, _integration, loader) => track('sha', loader);
				server.runtime.cache.getRepositoryDefaultBranch = (_repo, _integration, loader) =>
					track('default branch', loader);
				server.runtime.cache.getRepositoryMetadata = (_repo, _integration, loader) => track('metadata', loader);
				const { manager, azure } = await connect(server);
				try {
					const repo = descriptorFor(shortRemote);
					assert.equal(await azure.getPullRequestForBranch(repo, 'feature'), undefined);
					assert.equal(await azure.getPullRequestForCommit(repo, sha), undefined);
					assert.equal(await azure.getDefaultBranch(repo), undefined);
					assert.equal(await azure.getRepositoryMetadata(repo), undefined);
					const misses = ['feature', 'sha', 'default branch', 'metadata'];
					assert.deepEqual(invalidated(), kept ? [] : misses);
					// A full path reads as parsed either way, its answer kept.
					assert.equal((await azure.getPullRequestForBranch(descriptorFor(fullRemote), 'main'))?.id, '7');
					assert.deepEqual(invalidated(), kept ? [] : misses);
				} finally {
					manager.dispose();
				}
			});
		}

		test('a full path below the virtual directory reads without discovery, its miss cached', async () => {
			const server = createServer({ installation: '/tfs', failCollections: 500 });
			const reads: CacheController[] = [];
			const track = <V>(loader: (c: CacheController) => { value: V }): V => {
				const cacheable = new CacheController();
				reads.push(cacheable);
				return loader(cacheable).value;
			};
			server.runtime.cache.getPullRequestForBranch = (_branch, _repo, _integration, loader) => track(loader);
			server.runtime.cache.getPullRequestForSha = (_sha, _repo, _integration, loader) => track(loader);
			const { manager, azure } = await connect(server);
			try {
				const discovered = server.collectionReads();
				const repo = descriptorFor(fullRemote);
				assert.equal((await azure.getPullRequestForBranch(repo, 'feature'))?.id, '7');
				// The fake lists a pull request for any branch; a commit the query doesn't know is a genuine miss.
				assert.equal(await azure.getPullRequestForCommit(repo, 'c'.repeat(40)), undefined);
				assert.equal(
					server.collectionReads(),
					discovered,
					'no discovery for a path the project-less form cannot be',
				);
				assert.equal(reads.length, 2);
				assert.ok(
					reads.every(r => !r.invalidated),
					'both answers, the miss included, are kept',
				);
			} finally {
				manager.dispose();
			}
		});

		test('a canceled default branch or metadata read keeps its miss out of the caches', async () => {
			const server = createServer({ installation: '/tfs' });
			const reads: CacheController[] = [];
			const track = <V>(loader: (c: CacheController) => { value: V }): V => {
				const cacheable = new CacheController();
				reads.push(cacheable);
				return loader(cacheable).value;
			};
			server.runtime.cache.getRepositoryDefaultBranch = (_repo, _integration, loader) => track(loader);
			server.runtime.cache.getRepositoryMetadata = (_repo, _integration, loader) => track(loader);
			const { manager, azure } = await connect(server);
			try {
				const aborter = new AbortController();
				aborter.abort();
				const repo = descriptorFor(fullRemote);
				assert.equal(await azure.getDefaultBranch(repo, { cancellation: aborter.signal }), undefined);
				assert.equal(await azure.getRepositoryMetadata(repo, { cancellation: aborter.signal }), undefined);
				assert.deepEqual(
					reads.map(r => r.invalidated),
					[true, true],
				);
			} finally {
				manager.dispose();
			}
		});

		test('a failed discovery is kept until its TTL or a re-sync, then read again', async () => {
			const server = createServer({ installation: '/tfs', failCollections: 500, failCollectionsTimes: 2 });
			const realNow = Date.now;
			const { manager, azure } = await connect(server);
			try {
				const repo = descriptorFor(shortRemote);
				// The connect-time discovery failed once; the first read fails it again and keeps that.
				await azure.getPullRequestForBranch(repo, 'feature');
				const failed = server.collectionReads();
				assert.equal(failed, 2);
				await azure.getPullRequestForCommit(repo, sha);
				assert.equal(server.collectionReads(), failed, 'no retry within the TTL');

				const start = realNow();
				Date.now = () => start + discoveryCacheTtl + 1;
				const pr = await azure.getPullRequestForBranch(repo, 'feature');
				assert.equal(server.collectionReads(), failed + 1, 'read again past the TTL');
				assert.equal(pr?.id, '7', 'and the remote then resolves');
			} finally {
				Date.now = realNow;
				manager.dispose();
			}
		});

		test('a re-sync reads a failed discovery again', async () => {
			const server = createServer({ installation: '/tfs', failCollections: 500, failCollectionsTimes: 2 });
			const { manager, azure } = await connect(server);
			try {
				const repo = descriptorFor(shortRemote);
				await azure.getPullRequestForBranch(repo, 'feature');
				const failed = server.collectionReads();
				azure.invalidateDiscoveryCaches();
				const pr = await azure.getPullRequestForBranch(repo, 'feature');
				assert.equal(server.collectionReads(), failed + 1);
				assert.equal(pr?.id, '7');
			} finally {
				manager.dispose();
			}
		});

		test('a server-level identity failure still lets a full path read', async () => {
			const server = createServer({ installation: '/tfs', failServerIdentity: 500 });
			const watched = watchRequestFailures(server.runtime);
			const { manager, azure } = await connect(server);
			try {
				const notices = watched.notices.length;
				const pr = await azure.getPullRequestForBranch(descriptorFor(fullRemote), 'feature');
				assert.equal(pr?.id, '7');
				assert.ok(watched.notices.length - notices <= 1, watched.notices.join('; '));
			} finally {
				manager.dispose();
			}
		});

		test('concurrent reads share one discovery, and an aborted caller neither cancels nor keeps it', async () => {
			let release!: () => void;
			const hold = new Promise<void>(resolve => (release = resolve));
			const server = createServer({
				installation: '/tfs',
				failCollections: 500,
				failCollectionsTimes: 1,
				holdCollections: hold,
			});
			const { manager, azure } = await connect(server);
			try {
				const repo = descriptorFor(shortRemote);
				const before = server.collectionReads();
				const target = azure as unknown as {
					getRepositoryTarget(
						session: unknown,
						repo: unknown,
						cancellation?: AbortSignal,
					): Promise<{ repo: { owner: string } }>;
					_session: unknown;
				};
				const aborter = new AbortController();
				const aborted = target.getRepositoryTarget(target._session, repo, aborter.signal);
				const forBranch = azure.getPullRequestForBranch(repo, 'feature');
				const author = azure.getAccountForCommit(repo, sha);
				while (server.collectionReads() === before) {
					await new Promise(resolve => setTimeout(resolve, 0));
				}

				aborter.abort();
				await assert.rejects(aborted, ex => isCancellationError(ex));
				release();
				assert.equal((await forBranch)?.id, '7');
				assert.equal((await author)?.email, 'author@example.com');
				assert.equal(server.collectionReads(), before + 1, 'one discovery for every concurrent read');

				const settled = await target.getRepositoryTarget(target._session, repo);
				assert.equal(settled.repo.owner, 'DefaultCollection');
				assert.equal(server.collectionReads(), before + 1, 'the abort kept nothing');
			} finally {
				release();
				manager.dispose();
			}
		});
	});
});
