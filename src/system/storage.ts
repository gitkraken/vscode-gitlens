import type { Disposable, Event, ExtensionContext, SecretStorageChangeEvent } from 'vscode';
import { EventEmitter } from 'vscode';
import type {
	DeprecatedGlobalStorage,
	DeprecatedWorkspaceStorage,
	GlobalStorage,
	SecretKeys,
	WorkspaceStorage,
} from '../constants';
import { extensionPrefix } from '../constants';
import { debug } from './decorators/log';

export type StorageChangeEvent =
	| {
			/**
			 * The key of the stored value that has changed.
			 */
			readonly key: keyof (GlobalStorage & DeprecatedGlobalStorage);
			readonly workspace: false;
	  }
	| {
			/**
			 * The key of the stored value that has changed.
			 */
			readonly key: keyof (WorkspaceStorage & DeprecatedWorkspaceStorage);
			readonly workspace: true;
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
		this._disposable = this.context.secrets.onDidChange(e => this._onDidChangeSecrets.fire(e));
	}

	dispose(): void {
		this._disposable.dispose();
	}

	get<T extends keyof GlobalStorage>(key: T): GlobalStorage[T] | undefined;
	/** @deprecated */
	get<T extends keyof DeprecatedGlobalStorage>(key: T): DeprecatedGlobalStorage[T] | undefined;
	get<T extends keyof GlobalStorage>(key: T, defaultValue: GlobalStorage[T]): GlobalStorage[T];
	@debug({ logThreshold: 50 })
	get(key: keyof (GlobalStorage & DeprecatedGlobalStorage), defaultValue?: unknown): unknown | undefined {
		return this.context.globalState.get(`${extensionPrefix}:${key}`, defaultValue);
	}

	@debug({ logThreshold: 250 })
	async delete(key: keyof (GlobalStorage & DeprecatedGlobalStorage)): Promise<void> {
		await this.context.globalState.update(`${extensionPrefix}:${key}`, undefined);
		this._onDidChange.fire({ key: key, workspace: false });
	}

	@debug({ args: { 1: false }, logThreshold: 250 })
	async store<T extends keyof GlobalStorage>(key: T, value: GlobalStorage[T] | undefined): Promise<void> {
		await this.context.globalState.update(`${extensionPrefix}:${key}`, value);
		this._onDidChange.fire({ key: key, workspace: false });
	}

	@debug({ args: false, logThreshold: 250 })
	async getSecret(key: SecretKeys): Promise<string | undefined> {
		return this.context.secrets.get(key);
	}

	@debug({ args: false, logThreshold: 250 })
	async deleteSecret(key: SecretKeys): Promise<void> {
		return this.context.secrets.delete(key);
	}

	@debug({ args: false, logThreshold: 250 })
	async storeSecret(key: SecretKeys, value: string): Promise<void> {
		return this.context.secrets.store(key, value);
	}

	getWorkspace<T extends keyof WorkspaceStorage>(key: T): WorkspaceStorage[T] | undefined;
	/** @deprecated */
	getWorkspace<T extends keyof DeprecatedWorkspaceStorage>(key: T): DeprecatedWorkspaceStorage[T] | undefined;
	getWorkspace<T extends keyof WorkspaceStorage>(key: T, defaultValue: WorkspaceStorage[T]): WorkspaceStorage[T];
	@debug({ logThreshold: 25 })
	getWorkspace(
		key: keyof (WorkspaceStorage & DeprecatedWorkspaceStorage),
		defaultValue?: unknown,
	): unknown | undefined {
		return this.context.workspaceState.get(`${extensionPrefix}:${key}`, defaultValue);
	}

	@debug({ logThreshold: 250 })
	async deleteWorkspace(key: keyof (WorkspaceStorage & DeprecatedWorkspaceStorage)): Promise<void> {
		await this.context.workspaceState.update(`${extensionPrefix}:${key}`, undefined);
		this._onDidChange.fire({ key: key, workspace: true });
	}

	@debug({ args: { 1: false }, logThreshold: 250 })
	async storeWorkspace<T extends keyof WorkspaceStorage>(
		key: T,
		value: WorkspaceStorage[T] | undefined,
	): Promise<void> {
		await this.context.workspaceState.update(`${extensionPrefix}:${key}`, value);
		this._onDidChange.fire({ key: key, workspace: true });
	}
}
