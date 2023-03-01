import type { Disposable, Event, ExtensionContext, SecretStorageChangeEvent } from 'vscode';
import { EventEmitter } from 'vscode';
import type { ViewShowBranchComparison } from './config';
import type { StoredSearchQuery } from './git/search';
import type { Subscription } from './subscription';
import { debug } from './system/decorators/log';
import type { TrackedUsage, TrackedUsageKeys } from './telemetry/usageTracker';
import type { CompletedActions } from './webviews/home/protocol';

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
		return this.context.globalState.get(`gitlens:${key}`, defaultValue);
	}

	@debug({ logThreshold: 250 })
	async delete(key: keyof (GlobalStorage & DeprecatedGlobalStorage)): Promise<void> {
		await this.context.globalState.update(`gitlens:${key}`, undefined);
		this._onDidChange.fire({ key: key, workspace: false });
	}

	@debug({ args: { 1: false }, logThreshold: 250 })
	async store<T extends keyof GlobalStorage>(key: T, value: GlobalStorage[T] | undefined): Promise<void> {
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

	getWorkspace<T extends keyof WorkspaceStorage>(key: T): WorkspaceStorage[T] | undefined;
	/** @deprecated */
	getWorkspace<T extends keyof DeprecatedWorkspaceStorage>(key: T): DeprecatedWorkspaceStorage[T] | undefined;
	getWorkspace<T extends keyof WorkspaceStorage>(key: T, defaultValue: WorkspaceStorage[T]): WorkspaceStorage[T];
	@debug({ logThreshold: 25 })
	getWorkspace(
		key: keyof (WorkspaceStorage & DeprecatedWorkspaceStorage),
		defaultValue?: unknown,
	): unknown | undefined {
		return this.context.workspaceState.get(`gitlens:${key}`, defaultValue);
	}

	@debug({ logThreshold: 250 })
	async deleteWorkspace(key: keyof (WorkspaceStorage & DeprecatedWorkspaceStorage)): Promise<void> {
		await this.context.workspaceState.update(`gitlens:${key}`, undefined);
		this._onDidChange.fire({ key: key, workspace: true });
	}

	@debug({ args: { 1: false }, logThreshold: 250 })
	async storeWorkspace(key: keyof WorkspaceStorage, value: unknown | undefined): Promise<void> {
		await this.context.workspaceState.update(`gitlens:${key}`, value);
		this._onDidChange.fire({ key: key, workspace: true });
	}
}

export type SecretKeys = string;

export const enum SyncedStorageKeys {
	Version = 'gitlens:synced:version',
	PreReleaseVersion = 'gitlens:synced:preVersion',
	HomeViewWelcomeVisible = 'gitlens:views:welcome:visible',
}

export type DeprecatedGlobalStorage = {
	/** @deprecated */
	[key in `disallow:connection:${string}`]: any;
};

export type GlobalStorage = {
	avatars: [string, StoredAvatar][];
	'deepLinks:pending': StoredDeepLinkContext;
	'home:actions:completed': CompletedActions[];
	'home:steps:completed': string[];
	'home:sections:dismissed': string[];
	'home:status:pinned': boolean;
	'home:banners:dismissed': string[];
	pendingWelcomeOnFocus: boolean;
	pendingWhatsNewOnFocus: boolean;
	'plus:migratedAuthentication': boolean;
	'plus:discountNotificationShown': boolean;
	'plus:renewalDiscountNotificationShown': boolean;
	// Don't change this key name ('premium`) as its the stored subscription
	'premium:subscription': Stored<Subscription>;
	'synced:version': string;
	// Keep the pre-release version separate from the released version
	'synced:preVersion': string;
	usages: Record<TrackedUsageKeys, TrackedUsage>;
	version: string;
	// Keep the pre-release version separate from the released version
	preVersion: string;
	'views:layout': StoredViewsLayout;
	'views:welcome:visible': boolean;
	'views:commitDetails:dismissed': string[];
} & { [key in `provider:authentication:skip:${string}`]: boolean };

export type DeprecatedWorkspaceStorage = {
	/** @deprecated use `graph:filtersByRepo.excludeRefs` */
	'graph:hiddenRefs': Record<string, StoredGraphExcludedRef>;
	/** @deprecated use `views:searchAndCompare:pinned` */
	'pinned:comparisons': Record<string, DeprecatedPinnedComparison>;
};

export type WorkspaceStorage = {
	assumeRepositoriesOnStartup?: boolean;
	'branch:comparisons': StoredBranchComparisons;
	'gitComandPalette:usage': RecentUsage;
	gitPath: string;
	'graph:banners:dismissed': Record<string, boolean>;
	'graph:columns': Record<string, StoredGraphColumn>;
	'graph:filtersByRepo': Record<string, StoredGraphFilters>;
	'remote:default': string;
	'starred:branches': StoredStarred;
	'starred:repositories': StoredStarred;
	'views:repositories:autoRefresh': boolean;
	'views:searchAndCompare:keepResults': boolean;
	'views:searchAndCompare:pinned': StoredPinnedItems;
	'views:commitDetails:autolinksExpanded': boolean;
} & { [key in `connected:${string}`]: boolean };

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

export interface StoredDeepLinkContext {
	url?: string | undefined;
	repoPath?: string | undefined;
}

export interface StoredGraphColumn {
	isHidden?: boolean;
	width?: number;
}

export interface StoredGraphFilters {
	includeOnlyRefs?: Record<string, StoredGraphIncludeOnlyRef>;
	excludeRefs?: Record<string, StoredGraphExcludedRef>;
	excludeTypes?: Record<string, boolean>;
}

export type StoredGraphRefType = 'head' | 'remote' | 'tag';

export interface StoredGraphExcludedRef {
	id: string;
	type: StoredGraphRefType;
	name: string;
	owner?: string;
}

export interface StoredGraphIncludeOnlyRef {
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
