import type { Disposable, Event, ExtensionContext, SecretStorageChangeEvent } from 'vscode';
import { EventEmitter } from 'vscode';
import type { ViewShowBranchComparison } from './config';
import type { StoredSearchQuery } from './git/search';
import type { Subscription } from './subscription';
import { debug } from './system/decorators/log';
import type { TrackedUsage, TrackedUsageKeys } from './usageTracker';
import type { CompletedActions } from './webviews/home/protocol';

export type StorageChangeEvent =
	| {
			/**
			 * The key of the stored value that has changed.
			 */
			readonly key: GlobalStoragePath;
			readonly workspace: false;
	  }
	| {
			/**
			 * The key of the stored value that has changed.
			 */
			readonly key: WorkspaceStoragePath;
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

	get<T extends GlobalStoragePath>(key: T): GlobalStoragePathValue<T>;
	get<T extends GlobalStoragePath>(
		key: T,
		defaultValue: NonNullable<GlobalStoragePathValue<T>>,
	): NonNullable<GlobalStoragePathValue<T>>;
	@debug({ logThreshold: 50 })
	get<T extends GlobalStoragePath>(
		key: T,
		defaultValue?: GlobalStoragePathValue<T>,
	): GlobalStoragePathValue<T> | undefined {
		return this.context.globalState.get(`gitlens:${key}`, defaultValue);
	}

	@debug({ logThreshold: 250 })
	async delete<T extends GlobalStoragePath>(key: T): Promise<void> {
		await this.context.globalState.update(`gitlens:${key}`, undefined);
		this._onDidChange.fire({ key: key, workspace: false });
	}

	@debug({ args: { 1: false }, logThreshold: 250 })
	async store<T extends GlobalStoragePath>(key: T, value: GlobalStoragePathValue<T>): Promise<void> {
		await this.context.globalState.update(`gitlens:${key}`, value);
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

	getWorkspace<T extends WorkspaceStoragePath>(key: T): WorkspaceStoragePathValue<T>;
	getWorkspace<T extends WorkspaceStoragePath>(
		key: T,
		defaultValue: NonNullable<WorkspaceStoragePathValue<T>>,
	): NonNullable<WorkspaceStoragePathValue<T>>;
	@debug({ logThreshold: 25 })
	getWorkspace<T extends WorkspaceStoragePath>(
		key: T,
		defaultValue?: WorkspaceStoragePathValue<T>,
	): WorkspaceStoragePathValue<T> | undefined {
		return this.context.workspaceState.get(`gitlens:${key}`, defaultValue);
	}

	@debug({ logThreshold: 250 })
	async deleteWorkspace<T extends WorkspaceStoragePath>(key: T): Promise<void> {
		await this.context.workspaceState.update(`gitlens:${key}`, undefined);
		this._onDidChange.fire({ key: key, workspace: true });
	}

	@debug({ args: { 1: false }, logThreshold: 250 })
	async storeWorkspace<T extends WorkspaceStoragePath>(key: T, value: WorkspaceStoragePathValue<T>): Promise<void> {
		await this.context.workspaceState.update(`gitlens:${key}`, value);
		this._onDidChange.fire({ key: key, workspace: true });
	}
}

export type SecretKeys = string;

export const enum DeprecatedStorageKeys {
	/** @deprecated */
	DisallowConnectionPrefix = 'gitlens:disallow:connection:',
}

export const enum SyncedStorageKeys {
	Version = 'gitlens:synced:version',
	PreReleaseVersion = 'gitlens:synced:preVersion',
	HomeViewWelcomeVisible = 'gitlens:views:welcome:visible',
}

export interface GlobalStorage {
	avatars?: [string, StoredAvatar][];
	provider: {
		authentication: {
			skip: Record<string, boolean>;
		};
	};
	home: {
		actions: {
			completed?: CompletedActions[];
		};
		steps: {
			completed?: string[];
		};
		sections: {
			dismissed?: string[];
		};
	};
	pendingWelcomeOnFocus?: boolean;
	pendingWhatsNewOnFocus?: boolean;
	plus: {
		migratedAuthentication?: boolean;
		discountNotificationShown?: boolean;
	};
	// Don't change this key name ('premium`) as its the stored subscription
	premium: {
		subscription?: Stored<Subscription>;
	};
	synced: {
		version?: string;
		// Keep the pre-release version separate from the released version
		preVersion?: string;
	};
	usages?: Record<TrackedUsageKeys, TrackedUsage>;
	version?: string;
	// Keep the pre-release version separate from the released version
	preVersion?: string;
	views: {
		layout?: StoredViewsLayout;
		welcome: {
			visible?: boolean;
		};
		commitDetails: {
			dismissed?: string[];
		};
	};
}

export interface WorkspaceStorage {
	assumeRepositoriesOnStartup?: boolean;
	branch: {
		comparisons?: StoredBranchComparisons;
	};
	connected: Record<string, boolean>;
	gitComandPalette: {
		usage?: RecentUsage;
	};
	gitPath?: string;
	graph: {
		banners: {
			dismissed?: Record<string, boolean>;
		};
		columns?: Record<string, StoredGraphColumn>;
		hiddenRefs?: Record<string, StoredGraphHiddenRef>;
	};
	remote: {
		default?: string;
	};
	starred: {
		branches?: StoredStarred;
		repositories?: StoredStarred;
	};
	views: {
		repositories: {
			autoRefresh?: boolean;
		};
		searchAndCompare: {
			keepResults?: boolean;
			pinned?: StoredPinnedItems;
		};
		commitDetails: {
			autolinksExpanded?: boolean;
		};
	};

	pinned: {
		/** @deprecated use `gitlens:views:searchAndCompare:pinned` */
		comparisons?: DeprecatedPinnedComparisons;
	};
}

export type StoredViewsLayout = 'gitlens' | 'scm';
export interface Stored<T, SchemaVersion extends number = 1> {
	v: SchemaVersion;
	data: T;
}

export interface StoredAvatar {
	uri: string;
	timestamp: number;
}

export interface StoredBranchComparison {
	ref: string;
	notation: '..' | '...' | undefined;
	type: Exclude<ViewShowBranchComparison, false> | undefined;
}

export interface StoredBranchComparisons {
	[id: string]: string | StoredBranchComparison;
}

export interface StoredGraphColumn {
	isHidden?: boolean;
	width?: number;
}

export type StoredGraphRefType = 'head' | 'remote' | 'tag';

export interface StoredGraphHiddenRef {
	id: string;
	type: StoredGraphRefType;
	name: string;
	owner?: string;
}

export interface StoredNamedRef {
	label?: string;
	ref: string;
}

export interface StoredPinnedComparison {
	type: 'comparison';
	timestamp: number;
	path: string;
	ref1: StoredNamedRef;
	ref2: StoredNamedRef;
	notation?: '..' | '...';
}

export interface StoredPinnedSearch {
	type: 'search';
	timestamp: number;
	path: string;
	labels: {
		label: string;
		queryLabel:
			| string
			| {
					label: string;
					resultsType?: { singular: string; plural: string };
			  };
	};
	search: StoredSearchQuery;
}

export type StoredPinnedItem = StoredPinnedComparison | StoredPinnedSearch;
export type StoredPinnedItems = Record<string, StoredPinnedItem>;
export type StoredStarred = Record<string, boolean>;
export type RecentUsage = Record<string, number>;

interface DeprecatedPinnedComparison {
	path: string;
	ref1: StoredNamedRef;
	ref2: StoredNamedRef;
	notation?: '..' | '...';
}

interface DeprecatedPinnedComparisons {
	[id: string]: DeprecatedPinnedComparison;
}

type SubPath<T, Key extends keyof T> = Key extends string
	? T[Key] extends Record<string, any>
		?
				| `${Key}:${SubPath<T[Key], Exclude<keyof T[Key], keyof any[]>>}`
				| `${Key}:${Exclude<keyof T[Key], keyof any[]> & string}`
		: never
	: never;

type Path<T> = SubPath<T, keyof T> | keyof T;

type PathValue<T, P extends Path<T>> = P extends `${infer Key}:${infer Rest}`
	? Key extends keyof T
		? Rest extends Path<T[Key]>
			? PathValue<T[Key], Rest>
			: never
		: never
	: P extends keyof T
	? T[P]
	: never;

type GlobalStoragePath = Path<GlobalStorage>;
type GlobalStoragePathValue<P extends GlobalStoragePath> = PathValue<GlobalStorage, P>;

type WorkspaceStoragePath = Path<WorkspaceStorage>;
type WorkspaceStoragePathValue<P extends WorkspaceStoragePath> = PathValue<WorkspaceStorage, P>;
