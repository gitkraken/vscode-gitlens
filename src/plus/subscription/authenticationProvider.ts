import type {
	AuthenticationProvider,
	AuthenticationProviderAuthenticationSessionsChangeEvent,
	AuthenticationSession,
} from 'vscode';
import { authentication, Disposable, EventEmitter, extensions, window } from 'vscode';
import { uuid } from '@env/crypto';
import type { Container } from '../../container';
import { debug } from '../../system/decorators/log';
import { Logger } from '../../system/logger';
import { getLogScope } from '../../system/logger.scope';
import type { ServerConnection } from './serverConnection';

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

const authenticationId = 'gitlens+';
const authenticationLabel = 'GitLens+';

export class SubscriptionAuthenticationProvider implements AuthenticationProvider, Disposable {
	private _onDidChangeSessions = new EventEmitter<AuthenticationProviderAuthenticationSessionsChangeEvent>();
	get onDidChangeSessions() {
		return this._onDidChangeSessions.event;
	}

	private readonly _disposable: Disposable;
	private _sessionsPromise: Promise<AuthenticationSession[]>;

	constructor(private readonly container: Container, private readonly server: ServerConnection) {
		// Contains the current state of the sessions we have available.
		this._sessionsPromise = this.getSessionsFromStorage();

		this._disposable = Disposable.from(
			authentication.registerAuthenticationProvider(authenticationId, authenticationLabel, this, {
				supportsMultipleAccounts: false,
			}),
			this.container.storage.onDidChangeSecrets(() => this.checkForUpdates()),
		);
	}

	dispose() {
		this._disposable.dispose();
	}

	private get secretStorageKey(): string {
		return `gitlens.plus.auth:${this.container.env}`;
	}

	abort(): Promise<void> {
		return this.server.abort();
	}

	@debug()
	public async createSession(scopes: string[]): Promise<AuthenticationSession> {
		const scope = getLogScope();

		// Ensure that the scopes are sorted consistently (since we use them for matching and order doesn't matter)
		scopes = scopes.sort();
		const scopesKey = getScopesKey(scopes);

		try {
			const token = await this.server.login(scopes, scopesKey);
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
			if (ex === 'Cancelled') throw ex;

			Logger.error(ex, scope);
			void window.showErrorMessage(`Unable to sign in to GitLens+: ${ex}`);
			throw ex;
		}
	}

	@debug()
	async getSessions(scopes?: string[]): Promise<AuthenticationSession[]> {
		const scope = getLogScope();

		scopes = scopes?.sort();
		const scopesKey = getScopesKey(scopes);

		const sessions = await this._sessionsPromise;
		const filtered = scopes != null ? sessions.filter(s => getScopesKey(s.scopes) === scopesKey) : sessions;

		if (scope != null) {
			scope.exitDetails = ` \u2022 Found ${filtered.length} sessions`;
		}

		return filtered;
	}

	@debug()
	public async removeSession(id: string) {
		const scope = getLogScope();

		try {
			const sessions = await this._sessionsPromise;
			const sessionIndex = sessions.findIndex(session => session.id === id);
			if (sessionIndex === -1) {
				Logger.log(`Unable to remove session ${id}; Not found`);
				return;
			}

			const session = sessions[sessionIndex];
			sessions.splice(sessionIndex, 1);

			await this.storeSessions(sessions);

			this._onDidChangeSessions.fire({ added: [], removed: [session], changed: [] });
		} catch (ex) {
			Logger.error(ex, scope);
			void window.showErrorMessage(`Unable to sign out of GitLens+: ${ex}`);
			throw ex;
		}
	}

	@debug()
	public async removeSessionsByScopes(scopes?: string[]) {
		const scope = getLogScope();

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
			Logger.error(ex, scope);
			void window.showErrorMessage(`Unable to sign out of GitLens+: ${ex}`);
			throw ex;
		}
	}

	private _migrated: boolean | undefined;
	async tryMigrateSession(): Promise<AuthenticationSession | undefined> {
		if (this._migrated == null) {
			this._migrated = this.container.storage.get('plus:migratedAuthentication', false);
		}
		if (this._migrated) return undefined;

		let session: AuthenticationSession | undefined;
		try {
			if (extensions.getExtension('gitkraken.gitkraken-authentication') == null) return;

			session = await authentication.getSession('gitkraken', ['gitlens'], {
				createIfNone: false,
			});
			if (session == null) return;

			session = {
				id: uuid(),
				accessToken: session.accessToken,
				account: { ...session.account },
				scopes: session.scopes,
			};

			const sessions = await this._sessionsPromise;
			const scopesKey = getScopesKey(session.scopes);
			const sessionIndex = sessions.findIndex(s => s.id === session!.id || getScopesKey(s.scopes) === scopesKey);
			if (sessionIndex > -1) {
				sessions.splice(sessionIndex, 1, session);
			} else {
				sessions.push(session);
			}

			await this.storeSessions(sessions);

			this._onDidChangeSessions.fire({ added: [session], removed: [], changed: [] });
		} catch (ex) {
			Logger.error(ex, 'Unable to migrate authentication');
		} finally {
			this._migrated = true;
			void this.container.storage.store('plus:migratedAuthentication', true);
		}
		return session;
	}

	private async checkForUpdates() {
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
			Logger.debug(`Firing sessions changed event; added=${added.length}, removed=${removed.length}`);
			this._onDidChangeSessions.fire({ added: added, removed: removed, changed: [] });
		}
	}

	private async createSessionForToken(token: string, scopes: string[]): Promise<AuthenticationSession> {
		const userInfo = await this.server.getAccountInfo(token);
		return {
			id: uuid(),
			accessToken: token,
			account: { label: userInfo.accountName, id: userInfo.id },
			scopes: scopes,
		};
	}

	private async getSessionsFromStorage(): Promise<AuthenticationSession[]> {
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
			Logger.error(ex, 'Unable to read sessions from storage');
			return [];
		}

		const sessionPromises = storedSessions.map(async (session: StoredSession) => {
			const scopesKey = getScopesKey(session.scopes);

			Logger.debug(`Read session from storage with scopes=${scopesKey}`);

			let userInfo: { id: string; accountName: string } | undefined;
			if (session.account == null) {
				try {
					userInfo = await this.server.getAccountInfo(session.accessToken);
					Logger.debug(`Verified session with scopes=${scopesKey}`);
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
							? session.account.label ?? session.account.displayName ?? '<unknown>'
							: userInfo?.accountName ?? '<unknown>',
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

		Logger.debug(`Found ${verifiedSessions.length} verified sessions`);
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
}

function getScopesKey(scopes: readonly string[]): string;
function getScopesKey(scopes: undefined): string | undefined;
function getScopesKey(scopes: readonly string[] | undefined): string | undefined;
function getScopesKey(scopes: readonly string[] | undefined): string | undefined {
	return scopes?.join('|');
}
