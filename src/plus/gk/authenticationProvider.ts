import type {
	AuthenticationProvider,
	AuthenticationProviderAuthenticationSessionsChangeEvent,
	AuthenticationSession,
	Event,
} from 'vscode';
import { Disposable, EventEmitter, window } from 'vscode';
import { uuid } from '@env/crypto.js';
import type { TrackingContext } from '../../constants.telemetry.js';
import type { Container, Environment } from '../../container.js';
import { CancellationError } from '../../errors.js';
import { trace } from '../../system/decorators/log.js';
import { getLoggableName, Logger } from '../../system/logger.js';
import { getScopedLogger, maybeStartLoggableScope } from '../../system/logger.scope.js';
import { AuthenticationConnection } from './authenticationConnection.js';
import type { ServerConnection } from './serverConnection.js';

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

export const authenticationProviderId = 'gitlens+';
export const authenticationProviderScopes = ['gitlens'];

export interface AuthenticationProviderOptions {
	signUp?: boolean;
	signIn?: { code: string; state?: string };
	context?: TrackingContext;
}

export class AccountAuthenticationProvider implements AuthenticationProvider, Disposable {
	private _onDidChangeSessions = new EventEmitter<AuthenticationProviderAuthenticationSessionsChangeEvent>();
	get onDidChangeSessions(): Event<AuthenticationProviderAuthenticationSessionsChangeEvent> {
		return this._onDidChangeSessions.event;
	}

	private readonly _disposable: Disposable;
	private readonly _authConnection: AuthenticationConnection;
	private _sessionsPromise: Promise<AuthenticationSession[]>;
	private _optionsByScope: Map<string, AuthenticationProviderOptions> | undefined;

	constructor(
		private readonly container: Container,
		connection: ServerConnection,
	) {
		this._authConnection = new AuthenticationConnection(container, connection);

		// Contains the current state of the sessions we have available.
		this._sessionsPromise = this.getSessionsFromStorage();

		this._disposable = Disposable.from(
			this._onDidChangeSessions,
			this._authConnection,
			this.container.storage.onDidChangeSecrets(() => this.checkForUpdates()),
		);
	}

	dispose(): void {
		this._disposable.dispose();
	}

	private get secretStorageKey(): `gitlens.plus.auth:${Environment}` {
		return `gitlens.plus.auth:${this.container.env}`;
	}

	abort(): Promise<void> {
		return this._authConnection.abort();
	}

	public setOptionsForScopes(scopes: string[], options: AuthenticationProviderOptions): void {
		this._optionsByScope ??= new Map<string, AuthenticationProviderOptions>();
		this._optionsByScope.set(getScopesKey(scopes), options);
	}

	public clearOptionsForScopes(scopes: string[]): void {
		this._optionsByScope?.delete(getScopesKey(scopes));
	}

	@trace()
	public async createSession(scopes: string[]): Promise<AuthenticationSession> {
		const scope = getScopedLogger();

		const options = this._optionsByScope?.get(getScopesKey(scopes));
		if (options != null) {
			this._optionsByScope?.delete(getScopesKey(scopes));
		}
		// Ensure that the scopes are sorted consistently (since we use them for matching and order doesn't matter)
		scopes = scopes.sort();
		const scopesKey = getScopesKey(scopes);

		try {
			const token =
				options?.signIn != null
					? await this._authConnection.getTokenFromCodeAndState(options.signIn.code, options.signIn.state)
					: await this._authConnection.login(scopesKey, options?.signUp, options?.context);
			const session = await this.createSessionForToken(token, scopes);

			const sessions = await this._sessionsPromise;
			const sessionIndex = sessions.findIndex(s => s.id === session.id || getScopesKey(s.scopes) === scopesKey);
			if (sessionIndex > -1) {
				sessions.splice(sessionIndex, 1, session);
			} else {
				sessions.push(session);
			}
			await this.storeSessions(sessions);

			this._onDidChangeSessions.fire({ added: [session], removed: [], changed: [] });

			return session;
		} catch (ex) {
			// If login was cancelled, do not notify user.
			if (ex === 'Cancelled' || ex.message === 'Cancelled') throw ex;

			scope?.error(ex);
			void window.showErrorMessage(
				`Unable to sign in to GitKraken: ${
					ex instanceof CancellationError ? 'request timed out' : ex
				}. Please try again. If this issue persists, please contact support.`,
			);
			throw ex;
		}
	}

	@trace()
	async getSessions(scopes?: string[]): Promise<AuthenticationSession[]> {
		const scope = getScopedLogger();

		scopes = scopes?.sort();
		const scopesKey = getScopesKey(scopes);

		const sessions = await this._sessionsPromise;
		const filtered = scopes != null ? sessions.filter(s => getScopesKey(s.scopes) === scopesKey) : sessions;

		scope?.addExitInfo(`Found ${filtered.length} sessions`);

		return filtered;
	}

	@trace()
	public async removeSession(id: string): Promise<void> {
		const scope = getScopedLogger();

		try {
			const sessions = await this._sessionsPromise;
			const sessionIndex = sessions.findIndex(session => session.id === id);
			if (sessionIndex === -1) {
				scope?.debug(`Unable to remove session ${id}; Not found`);
				return;
			}

			const session = sessions[sessionIndex];
			sessions.splice(sessionIndex, 1);

			await this.storeSessions(sessions);

			this._onDidChangeSessions.fire({ added: [], removed: [session], changed: [] });
		} catch (ex) {
			scope?.error(ex);
			void window.showErrorMessage(`Unable to sign out of GitKraken: ${ex}`);
			throw ex;
		}
	}

	@trace()
	public async removeSessionsByScopes(scopes?: string[]): Promise<void> {
		const scope = getScopedLogger();

		try {
			scopes = scopes?.sort();
			const scopesKey = getScopesKey(scopes);

			const removed: AuthenticationSession[] = [];

			let index = 0;

			const sessions = await this._sessionsPromise;

			for (const session of sessions) {
				if (getScopesKey(session.scopes) !== scopesKey) {
					index++;
					continue;
				}

				sessions.splice(index, 1);
				removed.push(session);
			}

			if (removed.length === 0) return;

			await this.storeSessions(sessions);

			this._onDidChangeSessions.fire({ added: [], removed: removed, changed: [] });
		} catch (ex) {
			scope?.error(ex);
			void window.showErrorMessage(`Unable to sign out of GitKraken: ${ex}`);
			throw ex;
		}
	}

	private async checkForUpdates() {
		using scope = maybeStartLoggableScope(`${getLoggableName(this)}.checkForUpdates`);

		const previousSessions = await this._sessionsPromise;
		this._sessionsPromise = this.getSessionsFromStorage();
		const storedSessions = await this._sessionsPromise;

		const added: AuthenticationSession[] = [];
		const removed: AuthenticationSession[] = [];

		for (const session of storedSessions) {
			if (previousSessions.some(s => s.id === session.id)) continue;

			// Another window added a session, so let our window know about it
			added.push(session);
		}

		for (const session of previousSessions) {
			if (storedSessions.some(s => s.id === session.id)) continue;

			// Another window has removed this session (or logged out), so let our window know about it
			removed.push(session);
		}

		if (added.length || removed.length) {
			scope?.trace(`firing sessions changed event; added=${added.length}, removed=${removed.length}`);
			this._onDidChangeSessions.fire({ added: added, removed: removed, changed: [] });
		}
	}

	public async getOrCreateSession(
		scopes: string[],
		createIfNeeded: boolean,
	): Promise<AuthenticationSession | undefined> {
		const session = (await this.getSessions(scopes))[0];
		if (session != null) {
			return session;
		}
		if (!createIfNeeded) {
			return undefined;
		}
		return this.createSession(scopes);
	}

	private async createSessionForToken(token: string, scopes: string[]): Promise<AuthenticationSession> {
		const userInfo = await this._authConnection.getAccountInfo(token);
		return {
			id: uuid(),
			accessToken: token,
			account: { label: userInfo.accountName, id: userInfo.id },
			scopes: scopes,
		};
	}

	private async getSessionsFromStorage(): Promise<AuthenticationSession[]> {
		using scope = maybeStartLoggableScope(`${getLoggableName(this)}.getSessionsFromStorage`);

		let storedSessions: StoredSession[];

		try {
			const sessionsJSON = await this.container.storage.getSecret(this.secretStorageKey);
			if (!sessionsJSON || sessionsJSON === '[]') return [];

			try {
				storedSessions = JSON.parse(sessionsJSON);
			} catch (ex) {
				try {
					await this.container.storage.deleteSecret(this.secretStorageKey);
				} catch {}

				throw ex;
			}
		} catch (ex) {
			scope?.error(ex, 'Unable to read sessions from storage');
			return [];
		}

		const sessionPromises = storedSessions.map(async (session: StoredSession) => {
			const scopesKey = getScopesKey(session.scopes);

			scope?.trace(`read session from storage with scopes=${scopesKey}`);

			let userInfo: { id: string; accountName: string } | undefined;
			if (session.account == null) {
				try {
					userInfo = await this._authConnection.getAccountInfo(session.accessToken);
					scope?.trace(`verified session with scopes=${scopesKey}`);
				} catch (ex) {
					// Remove sessions that return unauthorized response
					if (ex.message === 'Unauthorized') return undefined;
				}
			}

			return {
				id: session.id,
				account: {
					label:
						session.account != null
							? (session.account.label ?? session.account.displayName ?? '<unknown>')
							: (userInfo?.accountName ?? '<unknown>'),
					id: session.account?.id ?? userInfo?.id ?? '<unknown>',
				},
				scopes: session.scopes,
				accessToken: session.accessToken,
			};
		});

		const verifiedSessions = (await Promise.allSettled(sessionPromises))
			.filter(p => p.status === 'fulfilled')
			.map(p => (p as PromiseFulfilledResult<AuthenticationSession | undefined>).value)
			.filter(<T>(p?: T): p is T => Boolean(p));

		scope?.trace(`found ${verifiedSessions.length} verified sessions`);
		if (verifiedSessions.length !== storedSessions.length) {
			await this.storeSessions(verifiedSessions);
		}
		return verifiedSessions;
	}

	private async storeSessions(sessions: AuthenticationSession[]): Promise<void> {
		try {
			this._sessionsPromise = Promise.resolve(sessions);
			await this.container.storage.storeSecret(this.secretStorageKey, JSON.stringify(sessions));
		} catch (ex) {
			Logger.error(ex, `Unable to store ${sessions.length} sessions`);
		}
	}

	async getExchangeToken(redirectPath?: string): Promise<string> {
		return this._authConnection.getExchangeToken(redirectPath);
	}
}

function getScopesKey(scopes: readonly string[]): string;
function getScopesKey(scopes: readonly string[] | undefined): string | undefined;
function getScopesKey(scopes: readonly string[] | undefined): string | undefined {
	return scopes?.join('|');
}
