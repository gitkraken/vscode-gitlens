import type { AuthenticationSession, Disposable } from 'vscode';
import { authentication } from 'vscode';
import { wrapForForcedInsecureSSL } from '@env/fetch';
import type { Container } from '../../../container';
import { debug } from '../../../system/decorators/log';
import type { ServerConnection } from '../../gk/serverConnection';
import type { IntegrationId } from '../providers/models';
import { HostingIntegrationId, IssueIntegrationId, SelfHostedIntegrationId } from '../providers/models';
import { AzureDevOpsAuthenticationProvider } from './azureDevOps';
import { BitbucketAuthenticationProvider } from './bitbucket';
import { GitHubEnterpriseAuthenticationProvider } from './github';
import { GitLabAuthenticationProvider } from './gitlab';
import { JiraAuthenticationProvider } from './jira';
import type { ProviderAuthenticationSession } from './models';

interface StoredSession {
	id: string;
	accessToken: string;
	account?: {
		label?: string;
		displayName?: string;
		id: string;
	};
	scopes: string[];
	expiresAt?: string;
}

export interface IntegrationAuthenticationProviderDescriptor {
	id: IntegrationId;
	scopes: string[];
}

export interface IntegrationAuthenticationSessionDescriptor {
	domain: string;
	scopes: string[];
	[key: string]: unknown;
}

export interface IntegrationAuthenticationProvider {
	getSessionId(descriptor?: IntegrationAuthenticationSessionDescriptor): string;
	createSession(
		descriptor?: IntegrationAuthenticationSessionDescriptor,
	): Promise<ProviderAuthenticationSession | undefined>;
}

export class IntegrationAuthenticationService implements Disposable {
	private readonly providers = new Map<IntegrationId, IntegrationAuthenticationProvider>();

	constructor(
		private readonly container: Container,
		private readonly connection: ServerConnection,
	) {}

	dispose() {
		this.providers.clear();
	}

	@debug()
	async createSession(
		providerId: IntegrationId,
		descriptor?: IntegrationAuthenticationSessionDescriptor,
	): Promise<AuthenticationSession | undefined> {
		const provider = this.ensureProvider(providerId);

		const session = await provider.createSession(descriptor);
		if (session == null) return undefined;

		const key = this.getSecretKey(providerId, provider.getSessionId(descriptor));
		await this.container.storage.storeSecret(key, JSON.stringify(session));

		return session;
	}

	@debug()
	async getSession(
		providerId: IntegrationId,
		descriptor?: IntegrationAuthenticationSessionDescriptor,
		options?: { createIfNeeded?: boolean; forceNewSession?: boolean },
	): Promise<ProviderAuthenticationSession | undefined> {
		if (this.supports(providerId)) {
			const provider = this.ensureProvider(providerId);

			const key = this.getSecretKey(providerId, provider.getSessionId(descriptor));

			if (options?.forceNewSession) {
				await this.container.storage.deleteSecret(key);
			}

			let storedSession: StoredSession | undefined;
			try {
				const sessionJSON = await this.container.storage.getSecret(key);
				if (sessionJSON) {
					storedSession = JSON.parse(sessionJSON);
				}
			} catch (ex) {
				try {
					await this.container.storage.deleteSecret(key);
				} catch {}

				if (!options?.createIfNeeded) {
					throw ex;
				}
			}

			if (
				(options?.createIfNeeded && storedSession == null) ||
				(storedSession?.expiresAt != null && new Date(storedSession.expiresAt).getTime() < Date.now())
			) {
				return this.createSession(providerId, descriptor);
			}

			return storedSession as ProviderAuthenticationSession | undefined;
		}

		if (descriptor == null) return undefined;

		const { createIfNeeded, forceNewSession } = options ?? {};
		return wrapForForcedInsecureSSL(
			this.container.integrations.ignoreSSLErrors({ id: providerId, domain: descriptor?.domain }),
			() =>
				authentication.getSession(providerId, descriptor.scopes, {
					createIfNone: forceNewSession ? undefined : createIfNeeded,
					silent: !createIfNeeded && !forceNewSession ? true : undefined,
					forceNewSession: forceNewSession ? true : undefined,
				}),
		);
	}

	@debug()
	async deleteSession(providerId: IntegrationId, descriptor?: IntegrationAuthenticationSessionDescriptor) {
		const provider = this.ensureProvider(providerId);

		const key = this.getSecretKey(providerId, provider.getSessionId(descriptor));
		await this.container.storage.deleteSecret(key);
	}

	supports(providerId: string): boolean {
		switch (providerId) {
			case HostingIntegrationId.AzureDevOps:
			case HostingIntegrationId.Bitbucket:
			case SelfHostedIntegrationId.GitHubEnterprise:
			case HostingIntegrationId.GitLab:
			case SelfHostedIntegrationId.GitLabSelfHosted:
			case IssueIntegrationId.Jira:
				return true;
			default:
				return false;
		}
	}

	private getSecretKey(providerId: string, id: string): `gitlens.integration.auth:${string}` {
		return `gitlens.integration.auth:${providerId}|${id}`;
	}

	private ensureProvider(providerId: IntegrationId): IntegrationAuthenticationProvider {
		let provider = this.providers.get(providerId);
		if (provider == null) {
			switch (providerId) {
				case HostingIntegrationId.AzureDevOps:
					provider = new AzureDevOpsAuthenticationProvider();
					break;
				case HostingIntegrationId.Bitbucket:
					provider = new BitbucketAuthenticationProvider();
					break;
				case SelfHostedIntegrationId.GitHubEnterprise:
					provider = new GitHubEnterpriseAuthenticationProvider();
					break;
				case HostingIntegrationId.GitLab:
				case SelfHostedIntegrationId.GitLabSelfHosted:
					provider = new GitLabAuthenticationProvider();
					break;
				case IssueIntegrationId.Jira:
					provider = new JiraAuthenticationProvider(this.connection);
					break;
				default:
					throw new Error(`Provider '${providerId}' is not supported`);
			}
			this.providers.set(providerId, provider);
		}

		return provider;
	}
}
