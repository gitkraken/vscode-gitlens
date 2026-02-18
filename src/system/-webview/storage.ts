import type { Event, ExtensionContext, SecretStorageChangeEvent } from 'vscode';
import { Disposable, env, EventEmitter } from 'vscode';
import { getPlatform, getRemoteInstanceIdentifier } from '@env/platform.js';
import { extensionPrefix } from '../../constants.js';
import type {
	DeprecatedGlobalStorage,
	DeprecatedWorkspaceStorage,
	GlobalScopedStorage,
	GlobalStorage,
	SecretKeys,
	WorkspaceStorage,
} from '../../constants.storage.js';
import { trace } from '../decorators/log.js';
import { registerCommand } from './command.js';

type GlobalStorageKeys = keyof (GlobalStorage & DeprecatedGlobalStorage);
type GlobalScopedStorageKeys = keyof GlobalScopedStorage;
type WorkspaceStorageKeys = keyof (WorkspaceStorage & DeprecatedWorkspaceStorage);

const allowedStoreCommandGlobalStorageKeys: GlobalStorageKeys[] = ['mcp:banner:dismissed'];
const allowedStoreCommandWorkspaceStorageKeys: WorkspaceStorageKeys[] = [];

interface StorageStoreCommandArgs {
	key: string;
	value: any;
	isWorkspace?: boolean;
}

export type StorageChangeEvent =
	| {
			/**
			 * The key of the stored value that has changed.
			 */
			readonly keys: GlobalStorageKeys[];
			readonly type: 'global';
	  }
	| {
			/**
			 * The key of the stored value that has changed (environment-scoped global storage).
			 */
			readonly keys: GlobalScopedStorageKeys[];
			readonly type: 'scoped';
	  }
	| {
			/**
			 * The key of the stored value that has changed.
			 */
			readonly keys: WorkspaceStorageKeys[];
			readonly type: 'workspace';
	  };

export class Storage implements Disposable {
	private _onDidChange = new EventEmitter<StorageChangeEvent>();
	get onDidChange(): Event<StorageChangeEvent> {
		return this._onDidChange.event;
	}

	private _onDidChangeSecrets = new EventEmitter<SecretStorageChangeEvent>();
	get onDidChangeSecrets(): Event<SecretStorageChangeEvent> {
		return this._onDidChangeSecrets.event;
	}

	private readonly _disposable: Disposable;
	constructor(private readonly context: ExtensionContext) {
		this._disposable = Disposable.from(
			this._onDidChange,
			this._onDidChangeSecrets,
			this.context.secrets.onDidChange(e => this._onDidChangeSecrets.fire(e)),
			registerCommand('gitlens.storage.store', args => this.storeFromCommand(args), this),
		);
	}

	dispose(): void {
		this._disposable.dispose();
	}

	get<T extends keyof GlobalStorage>(key: T): GlobalStorage[T] | undefined;
	/** @deprecated */
	get<T extends keyof DeprecatedGlobalStorage>(key: T): DeprecatedGlobalStorage[T] | undefined;
	get<T extends keyof GlobalStorage>(key: T, defaultValue: GlobalStorage[T]): GlobalStorage[T];
	@trace({ onlyExit: { after: 50 } })
	get(key: GlobalStorageKeys, defaultValue?: unknown): unknown | undefined {
		return this.context.globalState.get(`${extensionPrefix}:${key}`, defaultValue);
	}

	@trace({ onlyExit: { after: 250 } })
	async delete(key: GlobalStorageKeys): Promise<void> {
		await this.context.globalState.update(`${extensionPrefix}:${key}`, undefined);
		this._onDidChange.fire({ keys: [key], type: 'global' });
	}

	@trace({ onlyExit: { after: 250 } })
	async deleteWithPrefix(prefix: ExtractPrefixes<GlobalStorageKeys, ':'>): Promise<void> {
		return this.deleteWithPrefixCore(prefix);
	}

	async deleteWithPrefixCore(prefix?: ExtractPrefixes<GlobalStorageKeys, ':'>, exclude?: RegExp): Promise<void> {
		const qualifiedKeyPrefix = `${extensionPrefix}:`;

		const keys: GlobalStorageKeys[] = [];

		for (const qualifiedKey of this.context.globalState.keys() as `${typeof extensionPrefix}:${GlobalStorageKeys}`[]) {
			if (!qualifiedKey.startsWith(qualifiedKeyPrefix)) continue;

			const key = qualifiedKey.substring(qualifiedKeyPrefix.length) as GlobalStorageKeys;
			if (prefix == null || key === prefix || key.startsWith(`${prefix}:`)) {
				if (exclude?.test(key)) continue;

				keys.push(key);
				await this.context.globalState.update(qualifiedKey, undefined);
			}
		}

		if (keys.length) {
			this._onDidChange.fire({ keys: keys, type: 'global' });
		}
	}

	@trace({ onlyExit: { after: 250 } })
	async reset(): Promise<void> {
		return this.deleteWithPrefixCore(undefined, /^(premium:subscription|plus:preview:.*)$/);
	}

	@trace({ args: (key: keyof GlobalStorage) => ({ key: key }), onlyExit: { after: 250 } })
	async store<T extends keyof GlobalStorage>(key: T, value: GlobalStorage[T] | undefined): Promise<void> {
		await this.context.globalState.update(`${extensionPrefix}:${key}`, value);
		this._onDidChange.fire({ keys: [key], type: 'global' });
	}

	/**
	 * Returns a unique key for the current environment based on platform and remote authority.
	 * Used to scope storage keys that contain environment-specific data (like file paths)
	 * to avoid conflicts when globalState is shared across local/remote environments.
	 *
	 * The remote authority includes specific instance info (e.g., WSL distro, SSH host),
	 * derived from environment variables or hostname.
	 *
	 * @returns e.g., "windows", "linux", "wsl+ubuntu:linux", "ssh-remote+myserver:linux"
	 */
	private getEnvironmentScopeKey(): string {
		const platform = getPlatform();
		const remote = env.remoteName;
		if (remote == null) return platform;

		// Get instance identifier (e.g., WSL distro name, SSH hostname) to differentiate
		// between multiple instances of the same remote type
		const instance = getRemoteInstanceIdentifier();
		const key = instance ? `${remote}+${instance}:${platform}` : `${remote}:${platform}`;
		return key.toLowerCase();
	}

	getScoped<T extends keyof GlobalScopedStorage>(key: T): GlobalScopedStorage[T] | undefined;
	getScoped<T extends keyof GlobalScopedStorage>(
		key: T,
		defaultValue: GlobalScopedStorage[T],
	): GlobalScopedStorage[T];
	@trace({ onlyExit: { after: 50 } })
	getScoped<T extends keyof GlobalScopedStorage>(
		key: T,
		defaultValue?: GlobalScopedStorage[T],
	): GlobalScopedStorage[T] | undefined {
		const scopeKey = this.getEnvironmentScopeKey();
		const value = this.context.globalState.get<GlobalScopedStorage[T]>(`${extensionPrefix}:${scopeKey}:${key}`);
		if (value !== undefined) return value;

		// Fallback to legacy unscoped key for backward compatibility.
		// The consuming code should validate the data (e.g., check if paths exist)
		// since legacy data may be from a different environment.
		return this.context.globalState.get(`${extensionPrefix}:${key}`, defaultValue);
	}

	@trace({ onlyExit: { after: 250 } })
	async deleteScoped(key: keyof GlobalScopedStorage): Promise<void> {
		const scopeKey = this.getEnvironmentScopeKey();
		await this.context.globalState.update(`${extensionPrefix}:${scopeKey}:${key}`, undefined);
		this._onDidChange.fire({ keys: [key], type: 'scoped' });
	}

	@trace({ args: (key: keyof GlobalScopedStorage) => ({ key: key }), onlyExit: { after: 250 } })
	async storeScoped<T extends keyof GlobalScopedStorage>(
		key: T,
		value: GlobalScopedStorage[T] | undefined,
	): Promise<void> {
		const scopeKey = this.getEnvironmentScopeKey();
		await this.context.globalState.update(`${extensionPrefix}:${scopeKey}:${key}`, value);
		this._onDidChange.fire({ keys: [key], type: 'scoped' });
	}

	@trace({ args: false, onlyExit: { after: 250 } })
	async getSecret(key: SecretKeys): Promise<string | undefined> {
		return this.context.secrets.get(key);
	}

	@trace({ args: false, onlyExit: { after: 250 } })
	async deleteSecret(key: SecretKeys): Promise<void> {
		return this.context.secrets.delete(key);
	}

	@trace({ args: false, onlyExit: { after: 250 } })
	async storeSecret(key: SecretKeys, value: string): Promise<void> {
		return this.context.secrets.store(key, value);
	}

	getWorkspace<T extends keyof WorkspaceStorage>(key: T): WorkspaceStorage[T] | undefined;
	/** @deprecated */
	getWorkspace<T extends keyof DeprecatedWorkspaceStorage>(key: T): DeprecatedWorkspaceStorage[T] | undefined;
	getWorkspace<T extends keyof WorkspaceStorage>(key: T, defaultValue: WorkspaceStorage[T]): WorkspaceStorage[T];
	@trace({ onlyExit: { after: 25 } })
	getWorkspace(key: WorkspaceStorageKeys, defaultValue?: unknown): unknown | undefined {
		return this.context.workspaceState.get(`${extensionPrefix}:${key}`, defaultValue);
	}

	@trace({ onlyExit: { after: 250 } })
	async deleteWorkspace(key: WorkspaceStorageKeys): Promise<void> {
		await this.context.workspaceState.update(`${extensionPrefix}:${key}`, undefined);
		this._onDidChange.fire({ keys: [key], type: 'workspace' });
	}

	@trace({ onlyExit: { after: 250 } })
	async deleteWorkspaceWithPrefix(prefix: ExtractPrefixes<WorkspaceStorageKeys, ':'>): Promise<void> {
		return this.deleteWorkspaceWithPrefixCore(prefix);
	}

	async deleteWorkspaceWithPrefixCore(
		prefix?: ExtractPrefixes<WorkspaceStorageKeys, ':'>,
		exclude?: WorkspaceStorageKeys[],
	): Promise<void> {
		const qualifiedKeyPrefix = `${extensionPrefix}:`;

		const keys: WorkspaceStorageKeys[] = [];

		for (const qualifiedKey of this.context.workspaceState.keys() as `${typeof extensionPrefix}:${WorkspaceStorageKeys}`[]) {
			if (!qualifiedKey.startsWith(qualifiedKeyPrefix)) continue;

			const key = qualifiedKey.substring(qualifiedKeyPrefix.length) as WorkspaceStorageKeys;
			if (prefix == null || key === prefix || key.startsWith(`${prefix}:`)) {
				if (exclude?.includes(key)) continue;

				keys.push(key);
				await this.context.workspaceState.update(qualifiedKey, undefined);
			}
		}

		if (keys.length) {
			this._onDidChange.fire({ keys: keys, type: 'workspace' });
		}
	}

	@trace({ onlyExit: { after: 250 } })
	async resetWorkspace(): Promise<void> {
		return this.deleteWorkspaceWithPrefixCore();
	}

	@trace({ args: (key: keyof WorkspaceStorage) => ({ key: key }), onlyExit: { after: 250 } })
	async storeWorkspace<T extends keyof WorkspaceStorage>(
		key: T,
		value: WorkspaceStorage[T] | undefined,
	): Promise<void> {
		await this.context.workspaceState.update(`${extensionPrefix}:${key}`, value);
		this._onDidChange.fire({ keys: [key], type: 'workspace' });
	}

	async storeFromCommand(args: StorageStoreCommandArgs): Promise<void> {
		if (args.isWorkspace) {
			if (!allowedStoreCommandWorkspaceStorageKeys.includes(args.key as any)) {
				return;
			}
			await this.storeWorkspace(args.key as any, args.value);
		} else {
			if (!allowedStoreCommandGlobalStorageKeys.includes(args.key as any)) {
				return;
			}
			await this.store(args.key as any, args.value);
		}
	}
}
