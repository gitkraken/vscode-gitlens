import { ExtensionContext } from 'vscode';
import { ViewShowBranchComparison } from './config';
import { SearchPattern } from './git/search';

export class Storage {
	constructor(private readonly context: ExtensionContext) {}

	get<T>(key: GlobalState | SyncedState): T | undefined;
	get<T>(key: GlobalState | SyncedState, defaultValue: T): T;
	get<T>(key: GlobalState | SyncedState, defaultValue?: T): T | undefined {
		return this.context.globalState.get(key, defaultValue);
	}

	async delete(key: GlobalState | SyncedState): Promise<void> {
		return this.context.globalState.update(key, undefined);
	}

	async store(key: GlobalState | SyncedState, value: unknown): Promise<void> {
		return this.context.globalState.update(key, value);
	}

	getWorkspace<T>(key: WorkspaceState | `${WorkspaceState.ConnectedPrefix}${string}`): T | undefined;
	getWorkspace<T>(key: WorkspaceState | `${WorkspaceState.ConnectedPrefix}${string}`, defaultValue: T): T;
	getWorkspace<T>(
		key: WorkspaceState | `${WorkspaceState.ConnectedPrefix}${string}`,
		defaultValue?: T,
	): T | undefined {
		return this.context.workspaceState.get(key, defaultValue);
	}

	async deleteWorkspace(key: WorkspaceState | `${WorkspaceState.ConnectedPrefix}${string}`): Promise<void> {
		return this.context.workspaceState.update(key, undefined);
	}

	async storeWorkspace(
		key: WorkspaceState | `${WorkspaceState.ConnectedPrefix}${string}`,
		value: unknown,
	): Promise<void> {
		return this.context.workspaceState.update(key, value);
	}
}

export const enum GlobalState {
	Avatars = 'gitlens:avatars',
	PendingWelcomeOnFocus = 'gitlens:pendingWelcomeOnFocus',
	PendingWhatsNewOnFocus = 'gitlens:pendingWhatsNewOnFocus',
	Version = 'gitlens:version',

	Deprecated_Version = 'gitlensVersion',
}

export const enum SyncedState {
	Version = 'gitlens:synced:version',
	WelcomeViewVisible = 'gitlens:views:welcome:visible',

	Deprecated_DisallowConnectionPrefix = 'gitlens:disallow:connection:',
}

export const enum WorkspaceState {
	AssumeRepositoriesOnStartup = 'gitlens:assumeRepositoriesOnStartup',
	GitPath = 'gitlens:gitPath',

	BranchComparisons = 'gitlens:branch:comparisons',
	ConnectedPrefix = 'gitlens:connected:',
	DefaultRemote = 'gitlens:remote:default',
	GitCommandPaletteUsage = 'gitlens:gitComandPalette:usage',
	StarredBranches = 'gitlens:starred:branches',
	StarredRepositories = 'gitlens:starred:repositories',
	ViewsRepositoriesAutoRefresh = 'gitlens:views:repositories:autoRefresh',
	ViewsSearchAndCompareKeepResults = 'gitlens:views:searchAndCompare:keepResults',
	ViewsSearchAndComparePinnedItems = 'gitlens:views:searchAndCompare:pinned',

	Deprecated_DisallowConnectionPrefix = 'gitlens:disallow:connection:',
	Deprecated_PinnedComparisons = 'gitlens:pinned:comparisons',
}

export interface BranchComparison {
	ref: string;
	notation: '..' | '...' | undefined;
	type: Exclude<ViewShowBranchComparison, false> | undefined;
}

export interface BranchComparisons {
	[id: string]: string | BranchComparison;
}

export interface NamedRef {
	label?: string;
	ref: string;
}

export interface PinnedComparison {
	type: 'comparison';
	timestamp: number;
	path: string;
	ref1: NamedRef;
	ref2: NamedRef;
	notation?: '..' | '...';
}

export interface PinnedSearch {
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
	search: SearchPattern;
}

export type PinnedItem = PinnedComparison | PinnedSearch;

export interface PinnedItems {
	[id: string]: PinnedItem;
}

export interface Starred {
	[id: string]: boolean;
}

export interface Usage {
	[id: string]: number;
}
