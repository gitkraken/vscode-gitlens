import * as assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { suite, test } from 'mocha';
import { microhash } from '@gitlens/utils/hash.js';
import { Logger } from '@gitlens/utils/logger.js';
import { ConfiguredIntegrationService } from '../authentication/configuredIntegrationService.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import type { IssueWriteOptions } from '../index.js';
import { createIntegrationManager } from '../index.js';
import { createFakeRuntime } from './fakeRuntime.js';

const selected = { providerId: GitCloudHostIntegrationId.GitHub, connectionId: 'selected', owner: 'org', repo: 'repo' };
const existing = { ...selected, number: 42, expectedNodeId: 'I_42' };
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

	configured.dispose();
	const calls: {
		url: string;
		authorization: string | null;
		nextGlobalId: string | null;
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
	return { manager: manager, calls: calls, errors: errors };
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
						: { owner: 'org', repo: 'repo', expectedNodeId: 'I_42', checkDelete: false },
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
				checkDelete: true,
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
				checkDelete: false,
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
				checkDelete: false,
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
			assert.deepEqual(
				calls.map(call => (call.variables as { checkDelete: boolean }).checkDelete),
				[true, false],
			);
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
					providerId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
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
