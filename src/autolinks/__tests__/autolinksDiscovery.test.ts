// Initialize the command registry through the extension's entry path.
import '../../container.js';
import * as assert from 'node:assert/strict';
import { EventEmitter } from 'vscode';
import type { CacheableAutolinkReference } from '@gitlens/git/models/autolink.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import { IssuesCloudHostIntegrationId } from '@gitlens/integrations/constants.js';
import { createIntegrationService } from '@gitlens/integrations/integrationService.js';
import { defer } from '@gitlens/utils/promise.js';
import { createFakeRuntime } from '../../../packages/plus/integrations/src/__tests__/fakeRuntime.js';
import type { Container } from '../../container.js';
import { AutolinksProvider } from '../autolinksProvider.js';

function reference(prefix: string, url: string, referenceType?: 'branch'): CacheableAutolinkReference {
	return {
		prefix: prefix,
		url: url,
		referenceType: referenceType,
		alphanumeric: false,
		ignoreCase: false,
		title: undefined,
	};
}

async function createDiscoveryProvider(id: IssuesCloudHostIntegrationId.Linear | IssuesCloudHostIntegrationId.Jira) {
	const service = createIntegrationService(createFakeRuntime());
	const integration = await service.get(id);
	Reflect.set(integration, '_session', {
		id: 'primary',
		accessToken: 'token',
		account: { id: 'me', label: 'Me' },
		scopes: [],
		cloud: true,
		type: 'oauth',
		domain: id === IssuesCloudHostIntegrationId.Linear ? 'linear.app' : 'atlassian.net',
	});
	const state = {
		reads: 0,
		partial: true,
		fail: false,
		wait: undefined as Promise<void> | undefined,
		started: undefined as (() => void) | undefined,
	};
	const api = {
		getLinearOrganization: async () => ({ id: 'org', key: 'acme', name: 'Acme', url: 'https://linear.app/acme' }),
		getLinearTeamsForCurrentUser: async () => {
			const partial = state.partial;
			state.reads++;
			state.started?.();
			await state.wait;
			if (state.fail) throw new Error('Discovery unavailable');
			return partial
				? Array.from({ length: 50 }, (_, i) => ({
						id: `t${i}`,
						key: `T${i}`,
						name: `Team ${i}`,
						iconUrl: null,
					}))
				: [{ id: 'new', key: 'NEW', name: 'New team', iconUrl: null }];
		},
		getJiraResourcesForCurrentUser: async () => [{ id: 'site', name: 'Site', url: 'https://acme.atlassian.net' }],
		getJiraProjectsForResource: async () => {
			const partial = state.partial;
			state.reads++;
			state.started?.();
			await state.wait;
			if (state.fail) throw new Error('Discovery unavailable');
			return {
				values: [{ id: 'project', resourceId: 'site', key: partial ? 'T0' : 'NEW', name: 'Project' }],
				paging: { more: false },
				metadata: { completeness: partial ? 'partial' : 'complete' },
			};
		},
	};
	Reflect.set(integration, 'getProvidersApi', async () => api);
	const changed = new EventEmitter<void>();
	const connectionChanged = new EventEmitter<void>();
	const provider = new AutolinksProvider({
		integrations: {
			get: async (requested: string) => {
				return requested === id ? integration : undefined;
			},
			onDidChange: changed.event,
			onDidChangeConnectionState: connectionChanged.event,
		},
	} as unknown as Container);
	const internals = integration as unknown as {
		_autolinks: Map<string, { builtAt: number }>;
		_autolinksBuilds: Map<string, Promise<unknown>>;
	};
	return {
		provider: provider,
		integration: integration,
		state: state,
		expireAutolinks: () => {
			const cached = internals._autolinks.get('token');
			assert.ok(cached != null);
			internals._autolinks.set('token', { ...cached, builtAt: Date.now() - 60_001 });
		},
		pendingBuild: () => {
			const build = internals._autolinksBuilds.get('token');
			assert.ok(build != null, 'the integration started a background refresh');
			return build;
		},
		dispose: () => {
			provider.dispose();
			changed.dispose();
			connectionChanged.dispose();
			service.dispose();
		},
	};
}

suite('Host autolink discovery', () => {
	for (const id of [IssuesCloudHostIntegrationId.Linear, IssuesCloudHostIntegrationId.Jira] as const) {
		for (const branch of [false, true]) {
			test(`${id} retries partial discovery after its delay through ${branch ? 'getBranchAutolinks' : 'getAutolinks'}`, async () => {
				const fixture = await createDiscoveryProvider(id);
				const release = defer<void>();
				try {
					const render = (text: string) =>
						branch ? fixture.provider.getBranchAutolinks(text) : fixture.provider.getAutolinks(text);
					assert.equal((await render('T0-1')).size, 1, 'available partial prefixes remain usable');
					fixture.state.partial = false;
					assert.equal((await render('T0-1')).size, 1);
					assert.equal((await render('NEW-2')).size, 0);
					assert.equal(fixture.state.reads, 1, 'renders before the retry delay do not reread the provider');
					fixture.state.wait = release.promise;
					fixture.expireAutolinks();
					assert.equal(
						(await render('T0-1')).size,
						1,
						'the expiry render serves partial links while refreshing',
					);
					const refresh = fixture.pendingBuild();
					release.fulfill();
					await refresh;
					assert.equal(
						(await render('NEW-2')).size,
						1,
						'the next render uses refreshed integration references',
					);
					assert.equal(fixture.state.reads, 2);
					assert.equal((await render('NEW-3')).size, 1);
					assert.equal(fixture.state.reads, 2, 'complete integration discovery remains cached');
				} finally {
					release.fulfill();
					fixture.dispose();
				}
			});

			test(`${id} integration-only invalidation starts fresh discovery while the same host key is pending (${branch ? 'branch' : 'commit'})`, async () => {
				const fixture = await createDiscoveryProvider(id);
				const started = defer<void>();
				const release = defer<void>();
				try {
					const render = (text: string) =>
						branch ? fixture.provider.getBranchAutolinks(text) : fixture.provider.getAutolinks(text);
					fixture.state.wait = release.promise;
					fixture.state.started = () => started.fulfill();
					const before = render('T0-1');
					await started.promise;
					fixture.integration.invalidateDiscoveryCaches();
					fixture.state.partial = false;
					fixture.state.wait = undefined;
					const after = render('NEW-2');
					await new Promise<void>(resolve => setTimeout(resolve, 0));
					assert.equal(fixture.state.reads, 2, 'the new render must not join the retired discovery');
					assert.equal((await after).size, 1, 'fresh references arrive before the old read is released');
					release.fulfill();
					assert.equal((await before).size, 1, 'existing waiters can use their partial references');
					assert.equal((await render('NEW-3')).size, 1, 'late completion cannot restore stale references');
					assert.equal((await render('T0-1')).size, 0);
					assert.equal(fixture.state.reads, 2);
				} finally {
					release.fulfill();
					fixture.dispose();
				}
			});
		}

		test(`${id} coalesces integration discovery across concurrent host renders and remotes`, async () => {
			const fixture = await createDiscoveryProvider(id);
			const started = defer<void>();
			const release = defer<void>();
			try {
				fixture.state.wait = release.promise;
				fixture.state.started = () => started.fulfill();
				const first = fixture.provider.getAutolinks('T0-1');
				await started.promise;
				const second = fixture.provider.getAutolinks('T0-2');
				const otherRemote = fixture.provider.getAutolinks('T0-3', { remoteKey: 'other' } as GitRemote);
				const branch = fixture.provider.getBranchAutolinks('T0-4');
				release.fulfill();
				for (const links of await Promise.all([first, second, otherRemote, branch])) {
					assert.equal(links.size, 1);
				}
				assert.equal(fixture.state.reads, 1, 'integration builds coalesce across host keys');
			} finally {
				release.fulfill();
				fixture.dispose();
			}
		});

		test(`${id} retains remote and custom fallback after discovery fails, then retries`, async () => {
			const fixture = await createDiscoveryProvider(id);
			const release = defer<void>();
			try {
				fixture.state.fail = true;
				Reflect.set(fixture.provider, '_references', [reference('CUSTOM-', 'https://custom.invalid/<num>')]);
				const remote = {
					remoteKey: 'fallback',
					provider: {
						id: 'custom',
						autolinks: [
							reference('REMOTE-', 'https://remote.invalid/<num>'),
							reference('REMOTE-', 'https://remote.invalid/<num>', 'branch'),
						],
					},
				} as unknown as GitRemote;
				assert.equal((await fixture.provider.getAutolinks('CUSTOM-1 REMOTE-2', remote)).size, 2);
				assert.equal((await fixture.provider.getBranchAutolinks('REMOTE-2', remote)).size, 1);
				assert.equal(fixture.state.reads, 1, 'failed discovery is backed off across host rendering paths');
				fixture.state.fail = false;
				fixture.state.partial = false;
				fixture.state.wait = release.promise;
				fixture.expireAutolinks();
				assert.equal((await fixture.provider.getAutolinks('CUSTOM-1 REMOTE-2', remote)).size, 2);
				const refresh = fixture.pendingBuild();
				release.fulfill();
				await refresh;
				assert.equal((await fixture.provider.getAutolinks('NEW-3', remote)).size, 1);
				assert.equal((await fixture.provider.getBranchAutolinks('NEW-3', remote)).size, 1);
				assert.equal(fixture.state.reads, 2);
			} finally {
				release.fulfill();
				fixture.dispose();
			}
		});
	}
});
