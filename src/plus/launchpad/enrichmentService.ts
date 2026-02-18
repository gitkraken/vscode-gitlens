import type { CancellationToken, Disposable } from 'vscode';
import type { IntegrationIds } from '../../constants.integrations.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../../constants.integrations.js';
import type { Container } from '../../container.js';
import { AuthenticationRequiredError, CancellationError } from '../../errors.js';
import type { RemoteProvider } from '../../git/remotes/remoteProvider.js';
import { debug } from '../../system/decorators/log.js';
import { getScopedLogger } from '../../system/logger.scope.js';
import type { ServerConnection } from '../gk/serverConnection.js';
import { ensureAccount } from '../gk/utils/-webview/acount.utils.js';
import type { EnrichableItem, EnrichedItem, EnrichedItemResponse } from './models/enrichedItem.js';

type EnrichedItemRequest = {
	provider: EnrichedItemResponse['provider'];
	entityType: EnrichedItemResponse['entityType'];
	entityId: string;
	entityUrl: string;
	expiresAt?: string;
};

export class EnrichmentService implements Disposable {
	constructor(
		private readonly container: Container,
		private readonly connection: ServerConnection,
	) {}

	dispose(): void {}

	private async delete(id: string, context: 'unpin' | 'unsnooze'): Promise<void> {
		const scope = getScopedLogger();

		try {
			const rsp = await this.connection.fetchGkApi(`v1/enrich-items/${id}`, { method: 'DELETE' });

			if (!rsp.ok) throw new Error(`Unable to ${context} item '${id}':  (${rsp.status}) ${rsp.statusText}`);
		} catch (ex) {
			scope?.error(ex);
			debugger;
			throw ex;
		}
	}

	@debug()
	async get(type?: EnrichedItemResponse['type'], cancellation?: CancellationToken): Promise<EnrichedItem[]> {
		const scope = getScopedLogger();

		try {
			type Result = { data: EnrichedItemResponse[] };

			const rsp = await this.connection.fetchGkApi('v1/enrich-items', { method: 'GET' });
			if (cancellation?.isCancellationRequested) throw new CancellationError();

			const result = (await rsp.json()) as Result;
			if (cancellation?.isCancellationRequested) throw new CancellationError();

			return type == null ? result.data : result.data.filter(i => i.type === type);
		} catch (ex) {
			if (ex instanceof AuthenticationRequiredError) return [];

			scope?.error(ex);
			debugger;
			throw ex;
		}
	}

	@debug()
	getPins(cancellation?: CancellationToken): Promise<EnrichedItem[]> {
		return this.get('pin', cancellation);
	}

	@debug()
	getSnoozed(cancellation?: CancellationToken): Promise<EnrichedItem[]> {
		return this.get('snooze', cancellation);
	}

	@debug({ args: item => ({ item: `${item.id} (${item.provider} ${item.type})` }) })
	async pinItem(item: EnrichableItem): Promise<EnrichedItem> {
		const scope = getScopedLogger();

		try {
			if (
				!(await ensureAccount(this.container, 'Pinning is a Preview feature and requires an account.', {
					source: 'launchpad',
					detail: 'pin',
				}))
			) {
				throw new Error('Unable to pin item: account required');
			}

			type Result = { data: EnrichedItemResponse };

			const rq: EnrichedItemRequest = {
				provider: item.provider,
				entityType: item.type,
				entityId: item.id,
				entityUrl: item.url,
			};

			const rsp = await this.connection.fetchGkApi('v1/enrich-items/pin', {
				method: 'POST',
				body: JSON.stringify(rq),
			});

			if (!rsp.ok) {
				throw new Error(
					`Unable to pin item '${rq.provider}|${rq.entityUrl}#${item.id}':  (${rsp.status}) ${rsp.statusText}`,
				);
			}

			const result = (await rsp.json()) as Result;
			return result.data;
		} catch (ex) {
			scope?.error(ex);
			debugger;
			throw ex;
		}
	}

	@debug()
	unpinItem(id: string): Promise<void> {
		return this.delete(id, 'unpin');
	}

	@debug({ args: item => ({ item: `${item.id} (${item.provider} ${item.type})` }) })
	async snoozeItem(item: EnrichableItem): Promise<EnrichedItem> {
		const scope = getScopedLogger();

		try {
			if (
				!(await ensureAccount(this.container, 'Snoozing is a Preview feature and requires an acccount.', {
					source: 'launchpad',
					detail: 'snooze',
				}))
			) {
				throw new Error('Unable to snooze item: subscription required');
			}

			type Result = { data: EnrichedItemResponse };

			const rq: EnrichedItemRequest = {
				provider: item.provider,
				entityType: item.type,
				entityId: item.id,
				entityUrl: item.url,
			};
			if (item.expiresAt != null) {
				rq.expiresAt = item.expiresAt;
			}

			const rsp = await this.connection.fetchGkApi('v1/enrich-items/snooze', {
				method: 'POST',
				body: JSON.stringify(rq),
			});

			if (!rsp.ok) {
				throw new Error(
					`Unable to snooze item '${rq.provider}|${rq.entityUrl}#${item.id}':  (${rsp.status}) ${rsp.statusText}`,
				);
			}

			const result = (await rsp.json()) as Result;
			return result.data;
		} catch (ex) {
			scope?.error(ex);
			debugger;
			throw ex;
		}
	}

	@debug()
	unsnoozeItem(id: string): Promise<void> {
		return this.delete(id, 'unsnooze');
	}
}

const supportedRemoteProvidersToEnrich: Record<RemoteProvider['id'], EnrichedItemResponse['provider'] | undefined> = {
	'azure-devops': 'azure',
	bitbucket: 'bitbucket',
	'bitbucket-server': 'bitbucket',
	custom: undefined,
	gerrit: undefined,
	gitea: undefined,
	github: 'github',
	'cloud-github-enterprise': 'github',
	'cloud-gitlab-self-hosted': 'gitlab',
	gitlab: 'gitlab',
	'google-source': undefined,
};

const supportedIntegrationIdsToEnrich: Record<IntegrationIds, EnrichedItemResponse['provider'] | undefined> = {
	[GitCloudHostIntegrationId.AzureDevOps]: 'azure',
	[GitSelfManagedHostIntegrationId.AzureDevOpsServer]: 'azure',
	[GitCloudHostIntegrationId.GitLab]: 'gitlab',
	[GitCloudHostIntegrationId.GitHub]: 'github',
	[GitCloudHostIntegrationId.Bitbucket]: 'bitbucket',
	[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise]: 'github',
	[GitSelfManagedHostIntegrationId.GitHubEnterprise]: 'github',
	[GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted]: 'gitlab',
	[GitSelfManagedHostIntegrationId.GitLabSelfHosted]: 'gitlab',
	[GitSelfManagedHostIntegrationId.BitbucketServer]: 'bitbucket',
	[IssuesCloudHostIntegrationId.Jira]: 'jira',
	[IssuesCloudHostIntegrationId.Linear]: 'linear',
	[IssuesCloudHostIntegrationId.Trello]: 'trello',
};

export function convertRemoteProviderToEnrichProvider(provider: RemoteProvider): EnrichedItemResponse['provider'] {
	return convertRemoteProviderIdToEnrichProvider(provider.id);
}

export function convertRemoteProviderIdToEnrichProvider(id: RemoteProvider['id']): EnrichedItemResponse['provider'] {
	const enrichProvider = supportedRemoteProvidersToEnrich[id];
	if (enrichProvider == null) throw new Error(`Unknown remote provider '${id}'`);
	return enrichProvider;
}

export function isEnrichableRemoteProviderId(id: string): id is RemoteProvider['id'] {
	return supportedRemoteProvidersToEnrich[id as RemoteProvider['id']] != null;
}

export function isEnrichableIntegrationId(id: IntegrationIds): boolean {
	return supportedIntegrationIdsToEnrich[id] != null;
}

export function convertIntegrationIdToEnrichProvider(id: IntegrationIds): EnrichedItemResponse['provider'] {
	const enrichProvider = supportedIntegrationIdsToEnrich[id];
	if (enrichProvider == null) throw new Error(`Unknown integration id '${id}'`);
	return enrichProvider;
}
