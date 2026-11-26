import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { ConfiguredIntegrationService } from '../authentication/configuredIntegrationService.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import type { AzurePullRequestWriteOptions } from '../index.js';
import { createIntegrationManager } from '../index.js';
import { createFakeRuntime } from './fakeRuntime.js';

const organization = 'ExampleOrg';
const project = { id: '12ba3e78-27d9-4ad4-82a2-4142734e75f0', name: 'Example Project' };
const repo = { id: '58650c76-e42c-4377-9ddd-8c2fdecabaa5', name: 'Example Repo', project: project };
const accountId = 'c186e2f6-749d-4af6-82ca-67fbed9f205d';
const providerId = GitCloudHostIntegrationId.AzureDevOps;
const canonical = {
	organization: organization,
	projectId: project.id,
	projectName: project.name,
	repositoryId: repo.id,
	repositoryName: repo.name,
};
const scope = { connectionId: 'selected', organization: organization, project: project.name, repository: repo.name };
const address = {
	connectionId: scope.connectionId,
	expectedAccountId: accountId,
	organization: organization,
	projectId: project.id,
	repositoryId: repo.id,
};
const sourceSha = 'a'.repeat(40);
const targetSha = 'b'.repeat(40);
const sourceRef = 'refs/heads/feature/123';
const targetRef = 'refs/heads/main';
const pr = {
	pullRequestId: 42,
	repository: repo,
	status: 'active',
	title: 'Original',
	description: 'Description',
	sourceRefName: sourceRef,
	targetRefName: targetRef,
	lastMergeSourceCommit: { commitId: sourceSha },
	lastMergeTargetCommit: { commitId: targetSha },
	mergeStatus: 'succeeded',
};
const complete = {
	...address,
	action: 'complete',
	number: pr.pullRequestId,
	strategy: 'squash',
	expectedSourceRef: sourceRef,
	expectedTargetRef: targetRef,
	expectedSourceSha: sourceSha,
	expectedTargetSha: targetSha,
} satisfies AzurePullRequestWriteOptions;
const create = {
	...address,
	action: 'create',
	sourceRef: sourceRef,
	targetRef: targetRef,
	title: 'New',
} satisfies AzurePullRequestWriteOptions;
const repoPath = `/${organization}/${project.id}/_apis/git/repositories/${repo.id}`;
const namedRepoPath = `/${organization}/Example%20Project/_apis/git/repositories/Example%20Repo`;

type Call = { method: string; url: URL; body: Record<string, unknown> };
async function setup(auth: ProviderAuthenticationSession['type'] = 'oauth') {
	const runtime = createFakeRuntime();
	const configured = new ConfiguredIntegrationService(runtime);
	const selected: ProviderAuthenticationSession = {
		id: 'selected',
		accessToken: 'selected-token',
		account: { id: 'stored-label', label: 'Selected' },
		scopes: ['vso.code_manage'],
		cloud: true,
		type: auth,
		domain: 'dev.azure.com',
	};
	await configured.storeSession(providerId, { ...selected, id: 'primary', accessToken: 'primary-token' });
	await configured.storeSession(providerId, selected);
	await configured.setPrimaryConnection(providerId, 'primary');
	const calls: Call[] = [];
	const fixture = {
		manager: createIntegrationManager(runtime),
		current: { ...pr },
		calls: calls,
		respond: undefined as ((call: Call) => Response | undefined | Promise<Response | undefined>) | undefined,
		mutations: () => calls.filter(call => call.method !== 'GET'),
		cacheInvalidations: () => runtime.deletePullRequestsCalls,
		rotate: () => configured.storeSession(providerId, { ...selected, accessToken: 'rotated-token' }),
		dispose: () => {
			fixture.manager.dispose();
			configured.dispose();
		},
	};
	runtime.http.fetch = async (input, init) => {
		const url = new URL(String(input));
		const call = {
			method: init?.method ?? 'GET',
			url: url,
			body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {},
		};
		calls.push(call);
		const headers = new Headers(init?.headers);
		const accounts = url.pathname === '/_apis/accounts';
		const profile = url.pathname === '/_apis/profile/profiles/me';
		assert.equal(url.origin, accounts || profile ? 'https://app.vssps.visualstudio.com' : 'https://dev.azure.com');
		assert.equal(headers.get('authorization'), accounts ? 'Basic OnNlbGVjdGVkLXRva2Vu' : 'Bearer selected-token');
		assert.equal(init?.redirect, 'error');

		const custom = await fixture.respond?.(call);
		if (custom != null) return custom;

		if (call.method !== 'GET') {
			assert.equal(headers.get('content-type'), 'application/json');
		}

		switch (`${call.method} ${url.pathname}`) {
			case 'GET /_apis/profile/profiles/me':
				return Response.json({ id: accountId });
			case 'GET /_apis/accounts':
				assert.equal(url.searchParams.get('memberId'), accountId);
				return Response.json({ value: [{ accountName: organization }] });
			case `GET ${namedRepoPath}`:
			case `GET ${repoPath}`:
				return Response.json(repo);
			case `GET ${repoPath}/pullrequests/42`:
				return Response.json(fixture.current);
			case `GET /${organization}/${project.id}/_apis/git/policy/configurations`:
				assert.equal(url.searchParams.get('refName'), targetRef);
				assert.equal(url.searchParams.get('repositoryId'), repo.id);
				assert.equal(url.searchParams.get('policyType'), 'fa4e907d-c16b-4a4c-9dfa-4916e5d171ab');
				return Response.json({ value: [] });
			case `GET ${repoPath}/refs`:
				return Response.json({
					value:
						url.searchParams.get('filter') === sourceRef.slice(5)
							? [{ name: sourceRef, objectId: sourceSha }]
							: [{ name: targetRef, objectId: targetSha }],
				});
			case `POST ${repoPath}/pullrequests`:
				return Response.json({ ...pr, ...call.body, pullRequestId: 43 }, { status: 201 });
			case `PATCH ${repoPath}/pullrequests/42`:
				fixture.current = { ...fixture.current, ...call.body };
				return Response.json(fixture.current);
			default:
				assert.fail(`Unexpected request ${call.method} ${url.toString()}`);
		}
	};
	return fixture;
}

suite('IntegrationManager Azure DevOps Services pull request writes', () => {
	test('uses the selected account, resolves repo names and writes by canonical repository ID', async () => {
		const fixture = await setup();
		try {
			const capability = await fixture.manager.getAzurePullRequestCreateCapability({
				...scope,
				organization: 'exampleorg',
			});
			assert.deepEqual(capability, { ok: true, accountId: accountId, repository: canonical });

			const result = await fixture.manager.writeAzurePullRequest(create);
			assert.ok(result.ok);
			assert.equal(result.status, 'created');
			assert.equal(result.pullRequest.number, 43);
			assert.equal(result.pullRequest.title, create.title);
			assert.equal(
				result.pullRequest.url,
				`https://dev.azure.com/${organization}/Example%20Project/_git/Example%20Repo/pullrequest/43`,
			);
			const [request] = fixture.mutations();
			assert.equal(fixture.mutations().length, 1);
			assert.equal(request.url.pathname, `${repoPath}/pullrequests`);
			assert.deepEqual(request.body, {
				sourceRefName: sourceRef,
				targetRefName: targetRef,
				title: 'New',
			});
		} finally {
			fixture.dispose();
		}
	});

	test('invalidates cached PR reads after confirmed and uncertain writes', async () => {
		const fixture = await setup();
		try {
			const before = fixture.cacheInvalidations();
			const result = await fixture.manager.writeAzurePullRequest(create);
			assert.ok(result.ok);
			assert.equal(fixture.cacheInvalidations(), before + 1);

			fixture.respond = ({ method }) => {
				if (method === 'POST') throw new Error('connection reset');

				return undefined;
			};
			assert.deepEqual(await fixture.manager.writeAzurePullRequest(create), {
				ok: false,
				reason: 'outcome-unknown',
			});
			assert.equal(fixture.cacheInvalidations(), before + 2);

			const rejected = await fixture.manager.writeAzurePullRequest({ ...create, expectedAccountId: 'wrong' });
			assert.deepEqual(rejected, { ok: false, reason: 'no-connection' });
			assert.equal(fixture.cacheInvalidations(), before + 2);
		} finally {
			fixture.dispose();
		}
	});

	test('edits, abandons and reactivates the verified pull request without updating reviewer or policy data', async () => {
		const fixture = await setup();
		try {
			const existing = { ...address, number: 42 };
			const edit = await fixture.manager.writeAzurePullRequest({
				...existing,
				action: 'edit',
				title: 'Edited',
				description: '',
			});
			assert.ok(edit.ok && edit.status === 'updated');
			assert.equal(edit.pullRequest.description, '');
			const abandon = await fixture.manager.writeAzurePullRequest({ ...existing, action: 'abandon' });
			assert.ok(abandon.ok && abandon.status === 'abandoned');
			const abandoned = await fixture.manager.resolveAzurePullRequestWriteTarget({ ...scope, number: 42 });
			assert.ok(abandoned.ok && abandoned.capabilities.reactivate && !abandoned.capabilities.abandon);
			assert.equal(abandoned.capabilities.complete.kind, 'unavailable');
			const reactivate = await fixture.manager.writeAzurePullRequest({ ...existing, action: 'reactivate' });
			assert.ok(reactivate.ok && reactivate.status === 'reactivated');
			assert.deepEqual(
				fixture.mutations().map(call => call.body),
				[{ title: 'Edited', description: '' }, { status: 'abandoned' }, { status: 'active' }],
			);
		} finally {
			fixture.dispose();
		}
	});

	test('intersects applicable blocking merge policies across pages before allowing completion', async () => {
		const fixture = await setup();
		try {
			fixture.respond = ({ url }) => {
				if (!url.pathname.endsWith('/policy/configurations')) return undefined;

				if (!url.searchParams.has('continuationToken')) {
					return Response.json(
						{
							value: [
								{
									isEnabled: true,
									isBlocking: true,
									settings: { allowSquash: true, allowRebase: true },
								},
							],
						},
						{ headers: { 'x-ms-continuationtoken': 'next' } },
					);
				}

				assert.equal(url.searchParams.get('continuationToken'), 'next');
				return Response.json({
					value: [
						{ isEnabled: true, isBlocking: true, settings: { useSquashMerge: true } },
						{ isEnabled: true, isBlocking: false, settings: { allowRebaseMerge: true } },
					],
				});
			};
			const resolved = await fixture.manager.resolveAzurePullRequestWriteTarget({ ...scope, number: 42 });
			assert.ok(resolved.ok);
			assert.equal(resolved.accountId, accountId);
			assert.deepEqual(resolved.pullRequest.repository, canonical);
			assert.deepEqual(resolved.capabilities.complete, { kind: 'available', strategies: ['squash'] });
			assert.deepEqual(await fixture.manager.writeAzurePullRequest({ ...complete, strategy: 'rebase' }), {
				ok: false,
				reason: 'policy-blocked',
			});
			assert.equal(fixture.mutations().length, 0);

			const result = await fixture.manager.writeAzurePullRequest(complete);
			assert.ok(result.ok && result.status === 'completed');
			assert.deepEqual(fixture.mutations()[0].body, {
				status: 'completed',
				completionOptions: { mergeStrategy: 'squash', bypassPolicy: false },
				lastMergeSourceCommit: { commitId: sourceSha },
			});
			assert.equal(fixture.mutations().length, 1);
		} finally {
			fixture.dispose();
		}
	});

	test('rejects retargeted PRs and live stale branch tips without dispatching completion', async () => {
		const fixture = await setup();
		try {
			assert.deepEqual(
				await fixture.manager.writeAzurePullRequest({ ...complete, expectedTargetRef: 'refs/heads/other' }),
				{ ok: false, reason: 'target-changed' },
			);
			for (const [ref, reason] of [
				[sourceRef, 'source-changed'],
				[targetRef, 'target-changed'],
			]) {
				fixture.respond = ({ url }) =>
					url.searchParams.get('filter') === ref.slice(5)
						? Response.json({ value: [{ name: ref, objectId: 'c'.repeat(40) }] })
						: undefined;
				assert.deepEqual(await fixture.manager.writeAzurePullRequest(complete), { ok: false, reason: reason });
			}
			fixture.respond = ({ url }) =>
				url.searchParams.get('filter') === sourceRef.slice(5)
					? Response.json({ value: [{ name: `${sourceRef}-different`, objectId: sourceSha }] })
					: undefined;
			assert.deepEqual(await fixture.manager.writeAzurePullRequest(complete), {
				ok: false,
				reason: 'source-changed',
			});
			assert.equal(fixture.mutations().length, 0);
		} finally {
			fixture.dispose();
		}
	});

	test('stops completion when the PR is retargeted during policy reads', async () => {
		const fixture = await setup();
		try {
			fixture.respond = ({ url }) => {
				if (url.pathname.endsWith('/policy/configurations')) {
					fixture.current = { ...pr, targetRefName: 'refs/heads/other' };
				}
				return undefined;
			};
			assert.deepEqual(await fixture.manager.writeAzurePullRequest(complete), {
				ok: false,
				reason: 'target-changed',
			});
			assert.equal(fixture.mutations().length, 0);
		} finally {
			fixture.dispose();
		}
	});

	test('stops completion when the final PR read fails', async () => {
		const fixture = await setup();
		try {
			let preflightStarted = false;
			fixture.respond = ({ method, url }) => {
				if (url.pathname.endsWith('/policy/configurations')) {
					preflightStarted = true;
				}
				if (preflightStarted && method === 'GET' && url.pathname.endsWith('/pullrequests/42')) {
					return Response.json({}, { status: 503 });
				}
				return undefined;
			};
			assert.deepEqual(await fixture.manager.writeAzurePullRequest(complete), { ok: false, reason: 'unknown' });
			assert.equal(fixture.mutations().length, 0);
		} finally {
			fixture.dispose();
		}
	});

	test('rejects missing sessions, different accounts, invalid coordinates and mismatched provider targets', async () => {
		const fixture = await setup();
		try {
			assert.deepEqual(await fixture.manager.writeAzurePullRequest({ ...create, connectionId: 'missing' }), {
				ok: false,
				reason: 'no-connection',
			});
			assert.equal(fixture.calls.length, 0);
			assert.deepEqual(
				await fixture.manager.writeAzurePullRequest({ ...create, expectedAccountId: 'different' }),
				{ ok: false, reason: 'no-connection' },
			);
			assert.equal(fixture.calls.length, 1);
			assert.deepEqual(await fixture.manager.writeAzurePullRequest({ ...create, organization: 'OtherOrg' }), {
				ok: false,
				reason: 'not-found',
			});
			assert.deepEqual(await fixture.manager.writeAzurePullRequest({ ...create, projectId: '..' }), {
				ok: false,
				reason: 'invalid-input',
			});
			fixture.respond = ({ url }) =>
				url.pathname === repoPath
					? Response.json({ ...repo, project: { ...project, id: repo.id } })
					: undefined;
			assert.deepEqual(await fixture.manager.writeAzurePullRequest(create), { ok: false, reason: 'not-found' });
			fixture.respond = ({ url }) =>
				url.pathname === repoPath ? Response.json({ ...repo, id: project.id }) : undefined;
			assert.deepEqual(await fixture.manager.writeAzurePullRequest(create), { ok: false, reason: 'not-found' });
			fixture.respond = ({ url }) =>
				url.pathname.endsWith('/pullrequests/42') ? Response.json({ ...pr, pullRequestId: 43 }) : undefined;
			assert.deepEqual(await fixture.manager.writeAzurePullRequest(complete), { ok: false, reason: 'not-found' });
			assert.equal(fixture.mutations().length, 0);
		} finally {
			fixture.dispose();
		}
	});

	test('refuses PAT and connection rotation before dispatch', async () => {
		const pat = await setup('pat');
		const oauth = await setup();
		try {
			assert.deepEqual(await pat.manager.writeAzurePullRequest(create), { ok: false, reason: 'unsupported' });
			assert.equal(pat.calls.length, 0);

			oauth.respond = async ({ url }) => {
				if (url.pathname !== repoPath) return undefined;

				await oauth.rotate();
				return Response.json(repo);
			};
			assert.deepEqual(await oauth.manager.writeAzurePullRequest(create), { ok: false, reason: 'no-connection' });
			assert.equal(oauth.mutations().length, 0);
		} finally {
			pat.dispose();
			oauth.dispose();
		}
	});

	test('distinguishes provider rejection, pending completion, and ambiguous writes without retrying', async () => {
		const fixture = await setup();
		try {
			const cases: [number, object, string][] = [
				[400, {}, 'invalid-input'],
				[401, {}, 'forbidden'],
				[403, {}, 'forbidden'],
				[400, { typeKey: 'GitPullRequestExistsException' }, 'conflict'],
				[412, {}, 'conflict'],
				[429, {}, 'rate-limit'],
				[503, {}, 'outcome-unknown'],
				[200, {}, 'outcome-unknown'],
				[200, pr, 'outcome-unknown'],
				[200, { ...pr, mergeStatus: 'rejectedByPolicy' }, 'policy-blocked'],
				[200, { ...pr, status: 'completed', mergeStatus: 'rejectedByPolicy' }, 'policy-blocked'],
				[200, { ...pr, status: 'completed', mergeStatus: 'notSet' }, 'outcome-unknown'],
				[200, { ...pr, status: 'abandoned', mergeStatus: 'queued' }, 'outcome-unknown'],
				[400, { message: 'Required reviewers have not been approved' }, 'policy-blocked'],
				[409, { message: 'The source branch has changed' }, 'source-changed'],
			];
			for (const [status, body, reason] of cases) {
				fixture.respond = ({ method }) =>
					method === 'PATCH' ? Response.json(body, { status: status }) : undefined;
				const before = fixture.mutations().length;
				assert.deepEqual(await fixture.manager.writeAzurePullRequest(complete), { ok: false, reason: reason });
				assert.equal(fixture.mutations().length, before + 1);
			}
			fixture.respond = ({ method }) => {
				if (method === 'PATCH') throw new Error('connection reset');

				return undefined;
			};
			assert.deepEqual(await fixture.manager.writeAzurePullRequest(complete), {
				ok: false,
				reason: 'outcome-unknown',
			});
			assert.equal(fixture.mutations().length, cases.length + 1);

			fixture.respond = ({ method }) => {
				if (method !== 'PATCH') return undefined;

				fixture.current = { ...pr, status: 'completed', mergeStatus: 'queued' };
				return Response.json(fixture.current);
			};
			const pending = await fixture.manager.writeAzurePullRequest(complete);
			assert.ok(pending.ok && pending.status === 'pending');
			assert.equal(pending.pullRequest.state, 'active');
			const queued = await fixture.manager.resolveAzurePullRequestWriteTarget({ ...scope, number: 42 });
			assert.ok(queued.ok);
			assert.equal(queued.pullRequest.state, 'active');
			assert.deepEqual(queued.capabilities, {
				edit: false,
				abandon: false,
				reactivate: false,
				complete: { kind: 'unavailable', reason: 'conflict' },
			});

			fixture.current = { ...fixture.current, mergeStatus: 'succeeded' };
			const resolved = await fixture.manager.resolveAzurePullRequestWriteTarget({ ...scope, number: 42 });
			assert.ok(resolved.ok && resolved.pullRequest.state === 'completed');
			assert.equal(fixture.mutations().length, cases.length + 2);
		} finally {
			fixture.dispose();
		}
	});

	test('does not confirm completion when the merge status failed or has not settled', async () => {
		const fixture = await setup();
		try {
			const cases = [
				['rejectedByPolicy', 'policy-blocked'],
				['conflicts', 'conflict'],
				['failure', 'unknown'],
				['notSet', 'unknown'],
			];
			for (const [mergeStatus, reason] of cases) {
				fixture.current = { ...pr, status: 'completed', mergeStatus: mergeStatus };
				assert.deepEqual(await fixture.manager.resolveAzurePullRequestWriteTarget({ ...scope, number: 42 }), {
					ok: false,
					reason: reason,
				});
			}

			fixture.current = { ...pr, mergeStatus: 'rejectedByPolicy' };
			const active = await fixture.manager.resolveAzurePullRequestWriteTarget({ ...scope, number: 42 });
			assert.ok(active.ok && active.pullRequest.state === 'active');
			assert.equal(active.capabilities.complete.kind, 'available');
			assert.equal(fixture.mutations().length, 0);
		} finally {
			fixture.dispose();
		}
	});

	test('publishes completed on an edit receipt only when the merge succeeded', async () => {
		const fixture = await setup();
		try {
			const edit = { ...address, number: 42, action: 'edit', title: 'Edited' } as const;
			for (const mergeStatus of ['notSet', 'rejectedByPolicy', 'succeeded']) {
				fixture.respond = ({ method }) =>
					method === 'PATCH'
						? Response.json({ ...pr, title: edit.title, status: 'completed', mergeStatus: mergeStatus })
						: undefined;
				const result = await fixture.manager.writeAzurePullRequest(edit);
				if (mergeStatus === 'succeeded') {
					assert.ok(result.ok && result.status === 'updated' && result.pullRequest.state === 'completed');
				} else {
					assert.deepEqual(result, { ok: false, reason: 'outcome-unknown' });
				}
			}
			assert.equal(fixture.mutations().length, 3);
		} finally {
			fixture.dispose();
		}
	});
});
