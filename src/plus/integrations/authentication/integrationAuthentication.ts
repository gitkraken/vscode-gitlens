import type { AuthenticationSession, Disposable } from 'vscode';
import { authentication } from 'vscode';
import { wrapForForcedInsecureSSL } from '@env/fetch';
import type { Container } from '../../../container';
import { debug } from '../../../system/decorators/log';
import { ProviderId } from '../providers/models';
import { AzureDevOpsAuthenticationProvider } from './azureDevOps';
import { BitbucketAuthenticationProvider } from './bitbucket';
import { GitHubEnterpriseAuthenticationProvider } from './github';
import { GitLabAuthenticationProvider } from './gitlab';

interface StoredSession {
	id: string;
	accessToken: string;
	account?: {
		label?: string;
		displayName?: string;
		id: string;
	};
	scopes: string[];
}

export interface IntegrationAuthenticationProviderDescriptor {
	id: ProviderId;
	scopes: string[];
}

export interface IntegrationAuthenticationSessionDescriptor {
	domain: string;
	scopes: string[];
	[key: string]: unknown;
}

export interface IntegrationAuthenticationProvider {
	getSessionId(descriptor?: IntegrationAuthenticationSessionDescriptor): string;
	createSession(descriptor?: IntegrationAuthenticationSessionDescriptor): Promise<AuthenticationSession | undefined>;
}

export class IntegrationAuthenticationService implements Disposable {
	private readonly providers = new Map<ProviderId, IntegrationAuthenticationProvider>();

	constructor(private readonly container: Container) {}

	dispose() {
		this.providers.clear();
	}

	@debug()
	async createSession(
		providerId: ProviderId,
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
		providerId: ProviderId,
		descriptor?: IntegrationAuthenticationSessionDescriptor,
		options?: { createIfNeeded?: boolean; forceNewSession?: boolean },
	): Promise<AuthenticationSession | undefined> {
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

			if (options?.createIfNeeded && storedSession == null) {
				return this.createSession(providerId, descriptor);
			}

			return storedSession as AuthenticationSession | undefined;
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
	async deleteSession(providerId: ProviderId, descriptor?: IntegrationAuthenticationSessionDescriptor) {
		const provider = this.ensureProvider(providerId);

		const key = this.getSecretKey(providerId, provider.getSessionId(descriptor));
		await this.container.storage.deleteSecret(key);
	}

	supports(providerId: string): boolean {
		switch (providerId) {
			case ProviderId.AzureDevOps:
			case ProviderId.Bitbucket:
			case ProviderId.GitHubEnterprise:
			case ProviderId.GitLab:
			case ProviderId.GitLabSelfHosted:
				return true;
			default:
				return false;
		}
	}

	private getSecretKey(providerId: string, id: string): `gitlens.integration.auth:${string}` {
		return `gitlens.integration.auth:${providerId}|${id}`;
	}

	private ensureProvider(providerId: ProviderId): IntegrationAuthenticationProvider {
		let provider = this.providers.get(providerId);
		if (provider == null) {
			switch (providerId) {
				case ProviderId.AzureDevOps:
					provider = new AzureDevOpsAuthenticationProvider();
					break;
				case ProviderId.Bitbucket:
					provider = new BitbucketAuthenticationProvider();
					break;
				case ProviderId.GitHubEnterprise:
					provider = new GitHubEnterpriseAuthenticationProvider();
					break;
				case ProviderId.GitLab:
				case ProviderId.GitLabSelfHosted:
					provider = new GitLabAuthenticationProvider();
					break;
				default:
					throw new Error(`Provider '${providerId}' is not supported`);
			}
			this.providers.set(providerId, provider);
		}

		return provider;
	}
}
