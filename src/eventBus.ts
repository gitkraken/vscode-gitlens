import type { Disposable, Uri } from 'vscode';
import { EventEmitter } from 'vscode';
import type { CustomEditorIds, ViewIds, WebviewIds } from './constants.views';
import type { CachedGitTypes } from './git/gitProvider';
import type { GitCommit } from './git/models/commit';
import type { GitRevisionReference } from './git/models/reference';
import type { RepositoryChange } from './git/models/repository';
import type { GitCommitSearchContext } from './git/search';
import type { Draft, LocalDraft } from './plus/drafts/models/drafts';

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
interface GitCacheResetEventArgs {
	readonly repoPath?: string;
	readonly types?: CachedGitTypes[];
}

/**
 *  Out-of-band event to ensure @type {import('./git/models/repository').Repository} fires its change event
 *  Should only be listened to by @type {import('./git/models/repository').Repository}
 */
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
	/**
	 *  Out-of-band event to ensure @type {import('./git/models/repository').Repository} fires its change event
	 *  Should only be listened to by @type {import('./git/models/repository').Repository}
	 */
	'git:repo:change': GitRepoChangeEventArgs;
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
