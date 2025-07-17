import type { CancellationToken, Disposable } from 'vscode';
import type { IntegrationIds } from '../../constants.integrations';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../../constants.integrations';
import type { Container } from '../../container';
import { AuthenticationRequiredError, CancellationError } from '../../errors';
import type { RemoteProvider } from '../../git/remotes/remoteProvider';
import { log } from '../../system/decorators/log';
import { Logger } from '../../system/logger';
import { getLogScope } from '../../system/logger.scope';
import type { ServerConnection } from '../gk/serverConnection';
import { ensureAccount } from '../gk/utils/-webview/acount.utils';
import type { EnrichableItem, EnrichedItem, EnrichedItemResponse } from './models/enrichedItem';

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
		const scope = getLogScope();

		try {
			const rsp = await this.connection.fetchGkApi(`v1/enrich-items/${id}`, { method: 'DELETE' });

			if (!rsp.ok) throw new Error(`Unable to ${context} item '${id}':  (${rsp.status}) ${rsp.statusText}`);
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			throw ex;
		}
	}

	@log()
	async get(type?: EnrichedItemResponse['type'], cancellation?: CancellationToken): Promise<EnrichedItem[]> {
		const scope = getLogScope();

		try {
			type Result = { data: EnrichedItemResponse[] };

			const rsp = await this.connection.fetchGkApi('v1/enrich-items', { method: 'GET' });
			if (cancellation?.isCancellationRequested) throw new CancellationError();

			const result = (await rsp.json()) as Result;
			if (cancellation?.isCancellationRequested) throw new CancellationError();

			return type == null ? result.data : result.data.filter(i => i.type === type);
		} catch (ex) {
			if (ex instanceof AuthenticationRequiredError) return [];

			Logger.error(ex, scope);
			debugger;
			throw ex;
		}
	}

	@log()
	getPins(cancellation?: CancellationToken): Promise<EnrichedItem[]> {
		return this.get('pin', cancellation);
	}

	@log()
	getSnoozed(cancellation?: CancellationToken): Promise<EnrichedItem[]> {
		return this.get('snooze', cancellation);
	}

	@log<EnrichmentService['pinItem']>({ args: { 0: i => `${i.id} (${i.provider} ${i.type})` } })
	async pinItem(item: EnrichableItem): Promise<EnrichedItem> {
		const scope = getLogScope();

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
			Logger.error(ex, scope);
			debugger;
			throw ex;
		}
	}

	@log()
	unpinItem(id: string): Promise<void> {
		return this.delete(id, 'unpin');
	}

	@log<EnrichmentService['snoozeItem']>({ args: { 0: i => `${i.id} (${i.provider} ${i.type})` } })
	async snoozeItem(item: EnrichableItem): Promise<EnrichedItem> {
		const scope = getLogScope();

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
			Logger.error(ex, scope);
			debugger;
			throw ex;
		}
	}

	@log()
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
