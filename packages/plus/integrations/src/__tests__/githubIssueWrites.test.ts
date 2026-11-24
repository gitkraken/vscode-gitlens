import * as assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { suite, test } from 'mocha';
import { microhash } from '@gitlens/utils/hash.js';
import { Logger } from '@gitlens/utils/logger.js';
import { defer } from '@gitlens/utils/promise.js';
import { ConfiguredIntegrationService } from '../authentication/configuredIntegrationService.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import type { IssueWriteOptions } from '../index.js';
import { createIntegrationManager } from '../index.js';
import { createFakeRuntime } from './fakeRuntime.js';

const selected = { providerId: GitCloudHostIntegrationId.GitHub, connectionId: 'selected', owner: 'org', repo: 'repo' };
const existing = { ...selected, number: 42, expectedNodeId: 'I_42' };
const enterprise = {
	...selected,
	providerId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
	connectionId: 'enterprise-selected',
	domain: 'ghe.example.com:8443',
};
const enterpriseExisting = { ...enterprise, number: 42, expectedNodeId: 'I_42' };
const issue = {
	__typename: 'Issue',
	id: 'I_42',
	number: 42,
	url: 'https://github.com/Org/Repo/issues/42',
	title: 'Example',
	body: 'Body',
	state: 'OPEN',
	repository: { id: 'R_12', owner: { login: 'Org' }, name: 'Repo' },
	viewerCanDelete: true,
};
const repository = { id: 'R_12', hasIssuesEnabled: true, isArchived: false };
const writeTarget = { repository: repository, node: issue };
const snapshot = {
	owner: 'Org',
	repo: 'Repo',
	number: 42,
	nodeId: 'I_42',
	url: issue.url,
	title: issue.title,
	body: issue.body,
	state: 'open',
};

async function setup(
	respond: (query: string, authorization: string | null) => object | Response | Promise<object | Response>,
	primaryToken = 'token-primary',
	withEnterprise = false,
	enterpriseUrl = `http://${enterprise.domain}`,
) {
	const runtime = createFakeRuntime();
	const configured = new ConfiguredIntegrationService(runtime);
	for (const id of ['primary', 'selected']) {
		await configured.storeSession(GitCloudHostIntegrationId.GitHub, {
			id: id,
			accessToken: id === 'primary' ? primaryToken : 'token-selected',
			account: { id: id, label: id },
			scopes: ['repo'],
			cloud: true,
			type: 'oauth',
			domain: 'github.com',
		});
	}

	if (withEnterprise) {
		for (const [id, domain] of [
			['enterprise-primary', enterpriseUrl],
			[enterprise.connectionId, enterpriseUrl],
			['other-installation', 'https://ghe-other.example.com'],
		]) {
			await configured.storeSession(enterprise.providerId, {
				id: id,
				accessToken: `token-${id}`,
				account: { id: id, label: id },
				scopes: ['repo'],
				cloud: true,
				type: 'oauth',
				domain: domain,
			});
		}
	}

	configured.dispose();
	const calls: {
		url: string;
		authorization: string | null;
		nextGlobalId: string | null;
		redirect: RequestInit['redirect'];
		query: string;
		variables: unknown;
	}[] = [];
	const errors: string[] = [];
	runtime.http.fetch = async (url, init) => {
		assert.ok(typeof init?.body === 'string');
		const { query, variables } = JSON.parse(init.body) as { query: string; variables: unknown };
		const headers = new Headers(init.headers);
		const authorization = headers.get('authorization');
		calls.push({
			url: String(url),
			authorization: authorization,
			nextGlobalId: headers.get('x-github-next-global-id'),
			redirect: init.redirect,
			query: query.trimStart(),
			variables: variables,
		});
		const response = await respond(query.trimStart(), authorization);
		return response instanceof Response ? response : Response.json(response);
	};
	const manager = createIntegrationManager({
		...runtime,
		hooks: { ...runtime.hooks, ui: { onError: message => errors.push(message) } },
	});
	return { manager: manager, calls: calls, errors: errors, runtime: runtime };
}

suite('IntegrationManager GitHub issue writes', () => {
	const cases: {
		options: IssueWriteOptions;
		mutation: string;
		variables: object;
		state: string;
	}[] = [
		{
			options: { ...selected, action: 'create', title: 'Example', body: 'Body' },
			mutation: 'createIssue',
			variables: { repositoryId: 'R_12', title: 'Example', body: 'Body' },
			state: 'OPEN',
		},
		{
			options: { ...existing, action: 'edit', title: 'Edited', body: '' },
			mutation: 'updateIssue',
			variables: { id: 'I_42', title: 'Edited', body: '' },
			state: 'OPEN',
		},
		{
			options: { ...existing, action: 'set-state', state: 'closed', reason: 'completed' },
			mutation: 'closeIssue',
			variables: { issueId: 'I_42', stateReason: 'COMPLETED' },
			state: 'CLOSED',
		},
		{
			options: { ...existing, action: 'set-state', state: 'closed', reason: 'not_planned' },
			mutation: 'closeIssue',
			variables: { issueId: 'I_42', stateReason: 'NOT_PLANNED' },
			state: 'CLOSED',
		},
		{
			options: { ...existing, action: 'set-state', state: 'open' },
			mutation: 'reopenIssue',
			variables: { issueId: 'I_42' },
			state: 'OPEN',
		},
	];
	for (const { options, mutation, variables, state } of cases) {
		test(`routes ${mutation} (${JSON.stringify(variables)}) through the selected GitHub account and resource`, async () => {
			const updatedIssue = {
				...issue,
				state: state,
				...(options.action === 'edit' ? { title: options.title, body: options.body } : {}),
			};
			const { manager, calls } = await setup(query => ({
				data: query.startsWith('query') ? writeTarget : { change: { issue: updatedIssue } },
			}));
			try {
				assert.deepEqual(await manager.writeIssue(options), {
					ok: true,
					issue: {
						...snapshot,
						title: updatedIssue.title,
						body: updatedIssue.body,
						state: state === 'OPEN' ? 'open' : 'closed',
					},
				});
				assert.equal(calls.length, 2);
				assert.ok(calls.every(call => call.url === 'https://api.github.com/graphql'));
				assert.ok(calls.every(call => call.authorization === 'token token-selected'));
				assert.ok(calls.every(call => call.nextGlobalId === '1'));
				assert.match(calls[0].query, /followRenames: false/);
				assert.deepEqual(
					calls[0].variables,
					options.action === 'create'
						? { owner: 'org', repo: 'repo' }
						: { owner: 'org', repo: 'repo', expectedNodeId: 'I_42' },
				);
				if (options.action !== 'create') {
					assert.match(calls[0].query, /node\(id: \$expectedNodeId\)/);
				}

				assert.ok(calls[1].query.includes(`change: ${mutation}(input: $input)`));
				assert.deepEqual(calls[1].variables, { input: variables });
			} finally {
				manager.dispose();
			}
		});
	}

	test('permanently deletes an issue only through the separate operation and returns its last identity', async () => {
		const { manager, calls } = await setup(query => ({
			data: query.startsWith('query') ? writeTarget : { deleteIssue: { repository: { id: 'R_12' } } },
		}));
		try {
			const target = existing;
			assert.deepEqual(
				await manager.writeIssue({ ...target, action: 'delete' } as unknown as IssueWriteOptions),
				{
					ok: false,
					reason: 'invalid-input',
				},
			);
			assert.deepEqual(await manager.deleteIssue(target), { ok: true, issue: snapshot });
			assert.equal(calls.length, 2);
			assert.deepEqual(calls[0].variables, {
				owner: 'org',
				repo: 'repo',
				expectedNodeId: 'I_42',
			});
			assert.match(calls[1].query, /deleteIssue\(input: \{ issueId: \$issueId \}\)/);
			assert.deepEqual(calls[1].variables, { issueId: 'I_42' });
		} finally {
			manager.dispose();
		}
	});

	test('uses the GitHub-resolved ID when the displayed issue used the legacy format', async () => {
		const expectedNodeId = 'MDU6SXNzdWU0Mg==';
		const { manager, calls } = await setup(query => ({
			data: query.startsWith('query') ? writeTarget : { change: { issue: issue } },
		}));
		try {
			assert.deepEqual(
				await manager.writeIssue({
					...existing,
					action: 'edit',
					title: 'Example',
					expectedNodeId: expectedNodeId,
				}),
				{ ok: true, issue: snapshot },
			);
			assert.deepEqual(calls[0].variables, {
				owner: 'org',
				repo: 'repo',
				expectedNodeId: expectedNodeId,
			});
			assert.deepEqual(calls[1].variables, { input: { id: issue.id, title: 'Example' } });
		} finally {
			manager.dispose();
		}
	});

	test('keeps the confirmed deletion when GitHub reports it in a different repository', async () => {
		const { manager, calls } = await setup(query => ({
			data: query.startsWith('query') ? writeTarget : { deleteIssue: { repository: { id: 'R_transferred' } } },
		}));
		try {
			assert.deepEqual(await manager.deleteIssue(existing), {
				ok: true,
				issue: snapshot,
				deletedFromDifferentRepository: true,
			});
			assert.equal(calls.length, 2);
			assert.deepEqual(calls[1].variables, { issueId: issue.id });
		} finally {
			manager.dispose();
		}
	});

	test('keeps an unconfirmed deletion unknown', async () => {
		const { manager, calls } = await setup(query => ({
			data: query.startsWith('query') ? writeTarget : { deleteIssue: { repository: null } },
		}));
		try {
			assert.deepEqual(await manager.deleteIssue(existing), { ok: false, reason: 'unknown' });
			assert.equal(calls.length, 2);
		} finally {
			manager.dispose();
		}
	});

	test('resolves an existing issue to a canonical write target without issuing a mutation', async () => {
		const { manager, calls } = await setup(() => ({ data: writeTarget }));
		try {
			const expectedNodeId = 'MDU6SXNzdWU0Mg==';
			assert.deepEqual(await manager.resolveIssueWriteTarget({ ...existing, expectedNodeId: expectedNodeId }), {
				ok: true,
				nodeId: issue.id,
				issue: snapshot,
			});
			assert.deepEqual(await manager.resolveIssueWriteTarget({ ...existing, number: 43 }), {
				ok: false,
				reason: 'not-found',
			});
			assert.equal(calls.length, 2);
			assert.ok(calls.every(call => call.query.startsWith('query IssueWriteTarget')));
			assert.ok(calls.every(call => call.authorization === 'token token-selected' && call.nextGlobalId === '1'));
			assert.deepEqual(calls[0].variables, {
				owner: 'org',
				repo: 'repo',
				expectedNodeId: expectedNodeId,
			});
		} finally {
			manager.dispose();
		}
	});

	test('refuses a delete target the connection may not delete, before any mutation', async () => {
		const { manager, calls } = await setup(() => ({
			data: { repository: repository, node: { ...issue, viewerCanDelete: false } },
		}));
		try {
			assert.deepEqual(await manager.resolveIssueWriteTarget({ ...existing, intent: 'delete' }), {
				ok: false,
				reason: 'forbidden',
			});
			assert.deepEqual(await manager.resolveIssueWriteTarget(existing), {
				ok: true,
				nodeId: issue.id,
				issue: snapshot,
			});
			assert.equal(calls.length, 2);
			assert.ok(calls.every(call => call.query.startsWith('query IssueWriteTarget')));
			assert.match(calls[0].query, /viewerCanDelete/);
			assert.doesNotMatch(calls[1].query, /viewerCanDelete/);
			assert.deepEqual(await manager.resolveIssueWriteTarget({ ...existing, intent: 'edit' } as never), {
				ok: false,
				reason: 'invalid-input',
			});
			assert.equal(calls.length, 2);
		} finally {
			manager.dispose();
		}
	});

	test('keeps the original create target even when a caller changes the input while it is pending', async () => {
		const managedIssue = { ...issue, repository: { ...issue.repository, owner: { login: 'Org_managed' } } };
		const { manager, calls } = await setup(query => ({
			data: query.startsWith('query') ? { repository: repository } : { change: { issue: managedIssue } },
		}));
		try {
			const options: IssueWriteOptions = {
				...selected,
				owner: 'org_managed',
				action: 'create',
				title: 'Example',
			};
			const pending = manager.writeIssue(options);
			options.repo = 'another';
			options.title = 'Changed';
			assert.deepEqual(await pending, { ok: true, issue: { ...snapshot, owner: 'Org_managed' } });
			assert.deepEqual(calls[0].variables, { owner: 'org_managed', repo: 'repo' });
			assert.deepEqual(calls[1].variables, { input: { repositoryId: 'R_12', title: 'Example' } });
		} finally {
			manager.dispose();
		}
	});

	test('rejects missing connections, unsupported providers and invalid input before a GitHub request', async () => {
		const { manager, calls } = await setup(() => assert.fail('No GitHub request expected'));
		try {
			const create = { ...selected, action: 'create', title: 'Example' } as const;
			assert.deepEqual(await manager.writeIssue({ ...create, connectionId: 'gone' }), {
				ok: false,
				reason: 'no-connection',
			});
			assert.deepEqual(
				await manager.writeIssue({
					...create,
					providerId: GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted,
				}),
				{
					ok: false,
					reason: 'unsupported',
				},
			);
			for (const options of [
				{ ...create, connectionId: '' },
				{ ...create, title: '  ' },
				{ ...create, repo: 'repo/another' },
				{ ...existing, action: 'edit', number: 2147483648, title: 'Example' } as const,
				{ ...existing, action: 'edit' } as const,
				{ ...existing, action: 'edit', title: 'Example', expectedNodeId: '' } as const,
			]) {
				assert.deepEqual(await manager.writeIssue(options), { ok: false, reason: 'invalid-input' });
			}

			assert.equal(calls.length, 0);
		} finally {
			manager.dispose();
		}
	});

	for (const [target, reason] of [
		[{ ...writeTarget, repository: null }, 'not-found'],
		[{ ...writeTarget, node: null }, 'not-found'],
		[{ ...writeTarget, node: { ...issue, number: 43 } }, 'not-found'],
		[{ ...writeTarget, repository: { ...repository, id: 'R_replacement' } }, 'not-found'],
		[{ ...writeTarget, node: { ...issue, repository: { ...issue.repository, name: 'moved' } } }, 'not-found'],
		[{ ...writeTarget, repository: { ...repository, hasIssuesEnabled: false } }, 'unsupported'],
		[{ ...writeTarget, repository: { ...repository, isArchived: true } }, 'forbidden'],
		[{ ...writeTarget, node: { ...issue, viewerCanDelete: false } }, 'forbidden'],
	] as const) {
		test(`returns ${reason} for an unusable delete target without mutating`, async () => {
			const { manager, calls } = await setup(() => ({ data: target }));
			try {
				assert.deepEqual(await manager.deleteIssue(existing), { ok: false, reason: reason });
				assert.equal(calls.length, 1);
			} finally {
				manager.dispose();
			}
		});
	}

	test('isolates concurrent deletion lookups for connections with colliding token microhashes', async () => {
		const primaryToken = 'token-collision-5345';
		assert.equal(microhash(primaryToken, 3), microhash('token-selected', 3));
		const { manager, calls } = await setup(async (query, authorization) => {
			const allowed = authorization === 'token token-selected';
			if (query.startsWith('query')) {
				await setImmediate();
				return { data: { ...writeTarget, node: { ...issue, viewerCanDelete: allowed } } };
			}

			assert.ok(allowed);
			return { data: { deleteIssue: { repository: { id: 'R_12' } } } };
		}, primaryToken);
		try {
			assert.deepEqual(
				await Promise.all([
					manager.deleteIssue({ ...existing, connectionId: 'primary' }),
					manager.deleteIssue(existing),
				]),
				[
					{ ok: false, reason: 'forbidden' },
					{ ok: true, issue: snapshot },
				],
			);
			assert.equal(calls.filter(call => call.query.startsWith('query')).length, 2);
			assert.deepEqual(
				calls.filter(call => call.query.startsWith('mutation')).map(call => call.authorization),
				['token token-selected'],
			);
		} finally {
			manager.dispose();
		}
	});

	test('never emits raw provider messages through the issue-write debug callback', async () => {
		const { manager, errors } = await setup(query =>
			query.startsWith('query')
				? { data: { repository: repository } }
				: { data: null, errors: [{ type: 'UNPROCESSABLE', message: 'sensitive token-selected' }] },
		);
		Object.defineProperties(Logger, {
			isDebugging: { configurable: true, value: true },
			enabled: { configurable: true, value: () => false },
		});
		try {
			assert.deepEqual(await manager.writeIssue({ ...selected, action: 'create', title: 'Example' }), {
				ok: false,
				reason: 'invalid-input',
			});
			assert.deepEqual(errors, []);
		} finally {
			Reflect.deleteProperty(Logger, 'isDebugging');
			Reflect.deleteProperty(Logger, 'enabled');
			manager.dispose();
		}
	});

	test('classifies HTTP refusals and never retries a dispatched mutation', async () => {
		for (const [status, reason] of [
			[401, 'no-connection'],
			[403, 'forbidden'],
			[404, 'not-found'],
			[422, 'invalid-input'],
			[429, 'rate-limit'],
			[502, 'unknown'],
		] as const) {
			const { manager, calls } = await setup(query =>
				query.startsWith('query')
					? { data: { repository: repository } }
					: Response.json({ message: 'sensitive token-selected' }, { status: status }),
			);
			try {
				assert.deepEqual(await manager.writeIssue({ ...selected, action: 'create', title: 'Example' }), {
					ok: false,
					reason: reason,
				});
				assert.equal(calls.filter(call => call.query.startsWith('mutation')).length, 1);
			} finally {
				manager.dispose();
			}
		}
	});

	for (const [type, reason] of [
		['NOT_FOUND', 'not-found'],
		['FORBIDDEN', 'forbidden'],
		['UNPROCESSABLE', 'invalid-input'],
		['RATE_LIMIT', 'rate-limit'],
	] as const) {
		test(`returns ${reason} for ${type} without disclosing the raw provider error`, async () => {
			const { manager, calls } = await setup(query =>
				query.startsWith('query')
					? { data: { repository: repository } }
					: { data: null, errors: [{ type: type, message: 'sensitive token-selected', path: ['change'] }] },
			);
			try {
				assert.deepEqual(await manager.writeIssue({ ...selected, action: 'create', title: 'Example' }), {
					ok: false,
					reason: reason,
				});
				assert.equal(calls.length, 2);
			} finally {
				manager.dispose();
			}
		});
	}
});

suite('IntegrationManager GitHub Enterprise issue writes', () => {
	const enterpriseIssue = { ...issue, url: `http://${enterprise.domain}/Org/Repo/issues/42` };
	const enterpriseTarget = { repository: repository, node: enterpriseIssue };

	test('uses the selected installation and account through target resolution and all five mutations', async () => {
		const { manager, calls } = await setup(
			query => {
				if (query.startsWith('query WriteViewer')) {
					return { data: { viewer: { login: 'EnterpriseUser' } } };
				}

				if (query.startsWith('query')) return { data: enterpriseTarget };
				if (query.includes('deleteIssue')) {
					return { data: { deleteIssue: { repository: { id: 'R_transferred' } } } };
				}

				return { data: { change: { issue: enterpriseIssue } } };
			},
			undefined,
			true,
		);
		try {
			const written = { ok: true, issue: { ...snapshot, url: enterpriseIssue.url } };
			assert.deepEqual(await manager.resolveIssueWriteTarget({ ...enterpriseExisting, intent: 'delete' }), {
				...written,
				nodeId: enterpriseIssue.id,
			});
			assert.match(calls[0].query, /viewerCanDelete/);
			assert.deepEqual(await manager.writeIssue({ ...enterprise, action: 'create', title: 'Created' }), written);
			assert.deepEqual(await manager.writeIssue({ ...enterpriseExisting, action: 'edit', body: '' }), written);
			assert.deepEqual(
				await manager.writeIssue({
					...enterpriseExisting,
					action: 'set-state',
					state: 'closed',
					reason: 'not_planned',
				}),
				written,
			);
			assert.deepEqual(
				await manager.writeIssue({ ...enterpriseExisting, action: 'set-state', state: 'open' }),
				written,
			);
			assert.deepEqual(await manager.deleteIssue({ ...enterpriseExisting, expectedLogin: 'enterpriseuser' }), {
				...written,
				deletedFromDifferentRepository: true,
			});
			assert.equal(calls.length, 12);
			assert.match(calls.at(-3)!.query, /^query WriteViewer/);
			assert.ok(calls.every(call => call.url === `http://${enterprise.domain}/api/graphql`));
			assert.ok(calls.every(call => call.authorization === 'token token-enterprise-selected'));
			assert.ok(calls.every(call => call.redirect === 'error' && call.nextGlobalId == null));
			assert.deepEqual(
				calls.filter(call => call.query.startsWith('mutation')).map(call => call.variables),
				[
					{ input: { repositoryId: 'R_12', title: 'Created' } },
					{ input: { id: 'I_42', body: '' } },
					{ input: { issueId: 'I_42', stateReason: 'NOT_PLANNED' } },
					{ input: { issueId: 'I_42' } },
					{ issueId: 'I_42' },
				],
			);
		} finally {
			manager.dispose();
		}
	});

	test('checks the approved login with the credential that would send the deletion', async () => {
		const { manager, calls } = await setup(
			query => {
				assert.match(query, /^query WriteViewer/);
				return { data: { viewer: { login: 'different-user' } } };
			},
			undefined,
			true,
		);
		try {
			assert.deepEqual(await manager.deleteIssue({ ...enterpriseExisting, expectedLogin: 'approved-user' }), {
				ok: false,
				reason: 'no-connection',
			});
			assert.equal(calls.length, 1);
			assert.equal(calls[0].authorization, 'token token-enterprise-selected');
			assert.equal(calls[0].url, `http://${enterprise.domain}/api/graphql`);
		} finally {
			manager.dispose();
		}
	});

	test('distinguishes a failed viewer check from an unconfirmed mutation', async () => {
		const { manager, calls } = await setup(
			query => {
				assert.match(query, /^query WriteViewer/);
				return Response.json({ message: 'sensitive provider error' }, { status: 503 });
			},
			undefined,
			true,
		);
		try {
			assert.deepEqual(await manager.deleteIssue({ ...enterpriseExisting, expectedLogin: 'approved-user' }), {
				ok: false,
				reason: 'unknown',
				mutationDispatched: false,
			});
			assert.ok(calls.length > 0);
			assert.ok(calls.every(call => call.query.startsWith('query WriteViewer')));
		} finally {
			manager.dispose();
		}
	});

	test('uses the configured scheme when interpreting a requested bare port', async () => {
		const host = 'ghe-port.example.com';
		const { manager, calls } = await setup(
			() => assert.fail('No request should reach the HTTP installation'),
			undefined,
			true,
			`http://${host}:80`,
		);
		try {
			assert.deepEqual(await manager.deleteIssue({ ...enterpriseExisting, domain: `${host}:443` }), {
				ok: false,
				reason: 'no-connection',
			});
			assert.deepEqual(calls, []);
		} finally {
			manager.dispose();
		}
	});

	test('keeps port 443 when the selected HTTP installation actually listens there', async () => {
		const domain = 'ghe-port.example.com:443';
		const url = `http://${domain}`;
		const { manager, calls } = await setup(
			() => ({ data: { ...enterpriseTarget, node: { ...enterpriseIssue, url: `${url}/Org/Repo/issues/42` } } }),
			undefined,
			true,
			url,
		);
		try {
			const resolved = await manager.resolveIssueWriteTarget({ ...enterpriseExisting, domain: domain });
			assert.ok(resolved.ok);
			assert.equal(calls[0].url, `${url}/api/graphql`);
		} finally {
			manager.dispose();
		}
	});

	test('pins the effective HTTPS origin of a legacy connection with a default port', async () => {
		const domain = 'ghe-port.example.com:443';
		const url = 'https://ghe-port.example.com';
		const { manager, calls } = await setup(
			() => ({ data: { ...enterpriseTarget, node: { ...enterpriseIssue, url: `${url}/Org/Repo/issues/42` } } }),
			undefined,
			true,
			`https://${domain}`,
		);
		try {
			assert.deepEqual(
				await manager.resolveIssueWriteTarget({ ...enterpriseExisting, domain: `http://${domain}` }),
				{
					ok: false,
					reason: 'no-connection',
				},
			);
			assert.equal(calls.length, 0);
			assert.ok((await manager.resolveIssueWriteTarget({ ...enterpriseExisting, domain: domain })).ok);
			assert.equal(calls[0].url, `${url}/api/graphql`);
		} finally {
			manager.dispose();
		}
	});

	for (const change of ['replaced', 'restored', 'disposed']) {
		test(`refuses a deletion when the selected credential is ${change} during the target check`, async () => {
			const targetStarted = defer<void>();
			const targetFinished = defer<void>();
			const { manager, calls, runtime } = await setup(
				async query => {
					if (query.startsWith('query WriteViewer')) return { data: { viewer: { login: 'approved' } } };

					assert.match(query, /^query IssueWriteTarget/);
					targetStarted.fulfill();
					await targetFinished.promise;
					return { data: enterpriseTarget };
				},
				undefined,
				true,
			);
			const configured = new ConfiguredIntegrationService(runtime);
			try {
				const deleting = manager.deleteIssue({ ...enterpriseExisting, expectedLogin: 'approved' });
				await targetStarted.promise;
				if (change === 'disposed') {
					manager.dispose();
				} else {
					const replaced = {
						id: enterprise.connectionId,
						accessToken: 'token-replacement',
						domain: `http://${enterprise.domain}`,
						account: { id: 'replacement', label: 'replacement' },
						scopes: ['repo'],
						cloud: true,
						type: 'oauth',
					};
					await configured.storeSession(enterprise.providerId, { ...replaced, type: 'oauth' });
					if (change === 'restored') {
						await configured.storeSession(enterprise.providerId, {
							...replaced,
							accessToken: `token-${enterprise.connectionId}`,
							account: { id: enterprise.connectionId, label: enterprise.connectionId },
							type: 'oauth',
						});
					}
				}
				targetFinished.fulfill();
				assert.deepEqual(await deleting, { ok: false, reason: 'no-connection' });
				assert.equal(calls.length, 2);
				assert.ok(calls.every(call => call.authorization === 'token token-enterprise-selected'));
			} finally {
				targetFinished.fulfill();
				configured.dispose();
				manager.dispose();
			}
		});
	}

	test('reports an uncertain outcome after an error reading a nested mutation receipt', async () => {
		const { manager, calls } = await setup(
			query =>
				query.startsWith('query')
					? { data: enterpriseTarget }
					: {
							data: { change: null },
							errors: [
								{
									type: 'FORBIDDEN',
									message: 'receipt inaccessible',
									path: ['change', 'issue', 'repository'],
								},
							],
						},
			undefined,
			true,
		);
		try {
			assert.deepEqual(await manager.writeIssue({ ...enterprise, action: 'create', title: 'Example' }), {
				ok: false,
				reason: 'unknown',
			});
			assert.equal(calls.filter(call => call.query.startsWith('mutation')).length, 1);
		} finally {
			manager.dispose();
		}
	});

	test('checks delete permission before confirmation without requiring it for ordinary target resolution', async () => {
		const { manager, calls } = await setup(
			() => ({ data: { ...enterpriseTarget, node: { ...enterpriseIssue, viewerCanDelete: false } } }),
			undefined,
			true,
		);
		try {
			assert.deepEqual(await manager.resolveIssueWriteTarget({ ...enterpriseExisting, intent: 'delete' }), {
				ok: false,
				reason: 'forbidden',
			});
			assert.deepEqual(await manager.resolveIssueWriteTarget(enterpriseExisting), {
				ok: true,
				nodeId: enterpriseIssue.id,
				issue: { ...snapshot, url: enterpriseIssue.url },
			});
			assert.equal(calls.length, 2);
			assert.ok(calls.every(call => call.query.startsWith('query IssueWriteTarget')));
			assert.match(calls[0].query, /viewerCanDelete/);
			assert.doesNotMatch(calls[1].query, /viewerCanDelete/);
		} finally {
			manager.dispose();
		}
	});

	test('refuses a mismatched account or host before dispatch even when cloud has the same repository', async () => {
		const { manager, calls } = await setup(() => assert.fail('No GitHub request expected'), undefined, true);
		try {
			for (const target of [
				{ ...enterpriseExisting, domain: 'ghe.example.com' },
				{ ...enterpriseExisting, domain: 'ghe-other.example.com' },
				{ ...enterpriseExisting, connectionId: selected.connectionId },
			]) {
				assert.deepEqual(await manager.deleteIssue(target), { ok: false, reason: 'no-connection' });
			}

			for (const target of [
				{ ...enterpriseExisting, domain: undefined },
				{ ...enterpriseExisting, domain: 'github.com' },
				{ ...existing, domain: enterprise.domain },
			]) {
				assert.deepEqual(await manager.deleteIssue(target), { ok: false, reason: 'invalid-input' });
			}

			assert.equal(calls.length, 0);
		} finally {
			manager.dispose();
		}
	});

	for (const [response, reason] of [
		[{ data: writeTarget }, 'not-found'],
		[
			{
				data: {
					...enterpriseTarget,
					node: { ...enterpriseIssue, repository: { ...issue.repository, name: 'renamed' } },
				},
			},
			'not-found',
		],
		[{ data: { ...enterpriseTarget, node: { ...enterpriseIssue, viewerCanDelete: false } } }, 'forbidden'],
		[{ errors: [{ message: 'sensitive upstream data', extensions: { code: 'undefinedField' } }] }, 'unsupported'],
	] as const) {
		test(`returns ${reason} from the enterprise preflight without dispatching a delete`, async () => {
			const { manager, calls } = await setup(() => response, undefined, true);
			try {
				assert.deepEqual(await manager.deleteIssue(enterpriseExisting), { ok: false, reason: reason });
				assert.equal(calls.length, 1);
				assert.match(calls[0].query, /viewerCanDelete/);
			} finally {
				manager.dispose();
			}
		});
	}
});
