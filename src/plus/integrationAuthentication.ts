import type { AuthenticationSession, Disposable } from 'vscode';
import type { Container } from '../container';
import { debug } from '../system/decorators/log';

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
	id: string;
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
	private readonly providers = new Map<string, IntegrationAuthenticationProvider>();

	constructor(private readonly container: Container) {}

	dispose() {
		this.providers.clear();
	}

	registerProvider(providerId: string, provider: IntegrationAuthenticationProvider): Disposable {
		if (this.providers.has(providerId)) throw new Error(`Provider with id ${providerId} already registered`);

		this.providers.set(providerId, provider);
		return {
			dispose: () => this.providers.delete(providerId),
		};
	}

	hasProvider(providerId: string): boolean {
		return this.providers.has(providerId);
	}

	@debug()
	async createSession(
		providerId: string,
		descriptor?: IntegrationAuthenticationSessionDescriptor,
	): Promise<AuthenticationSession | undefined> {
		const provider = this.providers.get(providerId);
		if (provider == null) throw new Error(`Provider with id ${providerId} not registered`);

		const session = await provider?.createSession(descriptor);
		if (session == null) return undefined;

		const key = this.getSecretKey(providerId, provider.getSessionId(descriptor));
		await this.container.storage.storeSecret(key, JSON.stringify(session));

		return session;
	}

	@debug()
	async getSession(
		providerId: string,
		descriptor?: IntegrationAuthenticationSessionDescriptor,
		options?: { createIfNeeded?: boolean; forceNewSession?: boolean },
	): Promise<AuthenticationSession | undefined> {
		const provider = this.providers.get(providerId);
		if (provider == null) throw new Error(`Provider with id ${providerId} not registered`);

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

	@debug()
	async deleteSession(providerId: string, descriptor?: IntegrationAuthenticationSessionDescriptor) {
		const provider = this.providers.get(providerId);
		if (provider == null) throw new Error(`Provider with id ${providerId} not registered`);

		const key = this.getSecretKey(providerId, provider.getSessionId(descriptor));
		await this.container.storage.deleteSecret(key);
	}

	private getSecretKey(providerId: string, id: string): `gitlens.integration.auth:${string}` {
		return `gitlens.integration.auth:${providerId}|${id}`;
	}
}
