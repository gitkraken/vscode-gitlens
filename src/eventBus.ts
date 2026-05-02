import type { Disposable, Uri } from 'vscode';
import { EventEmitter } from 'vscode';
import type { CachedGitTypes, UriScopedCachedGitTypes } from '@gitlens/git/cache.js';
import { areUriScopedCachedGitTypes } from '@gitlens/git/cache.js';
import type { GitCommit } from '@gitlens/git/models/commit.js';
import type { GitBranchReference, GitRevisionReference } from '@gitlens/git/models/reference.js';
import type { GitCommitSearchContext } from '@gitlens/git/models/search.js';
import type { CustomEditorIds, ViewIds, WebviewIds } from './constants.views.js';
import type { RepositoryChange } from './git/models/repository.js';
import type { Draft, LocalDraft } from './plus/drafts/models/drafts.js';

export type CommitSelectedEvent = EventBusEvent<'commit:selected'>;
interface CommitSelectedEventArgs {
	readonly commit: GitRevisionReference | GitCommit;
	readonly interaction: 'active' | 'passive';
	readonly preserveFocus?: boolean;
	readonly preserveVisibility?: boolean;
	readonly searchContext?: GitCommitSearchContext;
}

export type DraftSelectedEvent = EventBusEvent<'draft:selected'>;
interface DraftSelectedEventArgs {
	readonly draft: LocalDraft | Draft;
	readonly interaction: 'active' | 'passive';
	readonly preserveFocus?: boolean;
	readonly preserveVisibility?: boolean;
}

export type FileSelectedEvent = EventBusEvent<'file:selected'>;
interface FileSelectedEventArgs {
	readonly uri: Uri;
	readonly preserveFocus?: boolean;
	readonly preserveVisibility?: boolean;
}

export type GitCacheResetEvent = EventBusEvent<'git:cache:reset'>;
type GitCacheResetEventArgs = Omit<GlobalGitCacheResetEventArgs | ScopedGitCacheResetEventArgs, 'types'> & {
	readonly types?: CachedGitTypes[];
};
interface GlobalGitCacheResetEventArgs {
	readonly repoPath?: string;
	readonly path?: never;
	readonly types?: CachedGitTypes[];
}

interface ScopedGitCacheResetEventArgs {
	readonly repoPath: string;
	/** Relative path within the repo for targeted file-level cache clearing */
	readonly path: string;
	readonly types: UriScopedCachedGitTypes[];
}

export function isUriScopedGitCacheReset(args: GitCacheResetEventArgs): args is ScopedGitCacheResetEventArgs {
	return (
		args.repoPath != null &&
		areUriScopedCachedGitTypes(args.types ?? []) &&
		(args as ScopedGitCacheResetEventArgs).path != null
	);
}

/** Event fired when a branch is published to a remote */
export type GitPublishEvent = EventBusEvent<'git:publish'>;
interface GitPublishEventArgs {
	readonly repoPath: string;
	readonly remote: string;
	readonly branch: GitBranchReference;
}

export type GitRepoChangeEvent = EventBusEvent<'git:repo:change'>;
interface GitRepoChangeEventArgs {
	readonly repoPath: string;
	readonly changes: RepositoryChange[];
}

type EventsMapping = {
	'commit:selected': CommitSelectedEventArgs;
	'draft:selected': DraftSelectedEventArgs;
	'file:selected': FileSelectedEventArgs;

	'git:cache:reset': GitCacheResetEventArgs;
	/** Event fired when a branch is published to a remote */
	'git:publish': GitPublishEventArgs;
	/**
	 *  Out-of-band event to ensure @type {import('./git/models/repository.js').GlRepository} fires its change event
	 *  Should only be listened to by @type {import('./git/models/repository.js').GlRepository}
	 */
	'git:repo:change': GitRepoChangeEventArgs;
	/**
	 * Event fired when the CLI integration IPC server is started
	 */
	'gk:cli:ipc:started': { discoveryFilePath: string | undefined };
	/**
	 * Event fired when MCP setup via CLI has completed successfully with extension-based registration
	 */
	'gk:cli:mcp:setup:completed': undefined;
};

interface EventBusEvent<T extends keyof EventsMapping = keyof EventsMapping> {
	name: T;
	data: EventsMapping[T];
	source?: EventBusSource | undefined;
}

export type EventBusSource = CustomEditorIds | ViewIds | WebviewIds;

export type EventBusOptions = {
	source?: EventBusSource;
};

type CacheableEventsMapping = {
	'commit:selected': CommitSelectedEventArgs;
	'draft:selected': DraftSelectedEventArgs;
	'file:selected': FileSelectedEventArgs;
};

const _cacheableEventNames = new Set<keyof CacheableEventsMapping>([
	'commit:selected',
	'draft:selected',
	'file:selected',
]);
const _cachedEventArgs = new Map<keyof CacheableEventsMapping, CacheableEventsMapping[keyof CacheableEventsMapping]>();
// Cache events by source to avoid stale data from different contexts (e.g., graph vs commitDetails)
const _cachedEventArgsBySource = new Map<
	string,
	Map<keyof CacheableEventsMapping, CacheableEventsMapping[keyof CacheableEventsMapping]>
>();

export class EventBus implements Disposable {
	private readonly _emitter = new EventEmitter<EventBusEvent>();

	dispose(): void {
		this._emitter.dispose();
	}

	fire<T extends keyof EventsMapping>(name: T, data: EventsMapping[T], options?: EventBusOptions): void {
		if (canCacheEventArgs(name)) {
			_cachedEventArgs.set(name, data as CacheableEventsMapping[typeof name]);
			// Also cache by source to avoid stale data from different contexts
			if (options?.source != null) {
				let sourceCache = _cachedEventArgsBySource.get(options.source);
				if (sourceCache == null) {
					sourceCache = new Map();
					_cachedEventArgsBySource.set(options.source, sourceCache);
				}
				sourceCache.set(name, data as CacheableEventsMapping[typeof name]);
			}
		}
		this._emitter.fire({ name: name, data: data, source: options?.source });
	}

	fireAsync<T extends keyof EventsMapping>(name: T, data: EventsMapping[T], options?: EventBusOptions): void {
		queueMicrotask(() => this.fire(name, data, options));
	}

	getCachedEventArgs<T extends keyof CacheableEventsMapping>(name: T): CacheableEventsMapping[T] | undefined {
		return _cachedEventArgs.get(name) as CacheableEventsMapping[T] | undefined;
	}

	getCachedEventArgsBySource<T extends keyof CacheableEventsMapping>(
		name: T,
		source: EventBusSource,
	): CacheableEventsMapping[T] | undefined {
		return _cachedEventArgsBySource.get(source)?.get(name) as CacheableEventsMapping[T] | undefined;
	}

	on<T extends keyof EventsMapping>(name: T, handler: (e: EventBusEvent<T>) => void, thisArgs?: unknown): Disposable {
		return this._emitter.event(
			// eslint-disable-next-line prefer-arrow-callback
			function (e) {
				if (name !== e.name) return;
				handler.call(thisArgs, e as EventBusEvent<T>);
			},
			thisArgs,
		);
	}
}

function canCacheEventArgs(name: keyof EventsMapping): name is keyof CacheableEventsMapping {
	return _cacheableEventNames.has(name as keyof CacheableEventsMapping);
}
