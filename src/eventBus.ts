import type { Disposable, Uri } from 'vscode';
import { EventEmitter } from 'vscode';
import type { CustomEditorIds, ViewIds, WebviewIds } from './constants.views';
import type { GitCaches } from './git/gitProvider';
import type { GitCommit } from './git/models/commit';
import type { GitRevisionReference } from './git/models/reference';
import type { Draft, LocalDraft } from './gk/models/drafts';

export type CommitSelectedEvent = EventBusEvent<'commit:selected'>;
interface CommitSelectedEventArgs {
	readonly commit: GitRevisionReference | GitCommit;
	readonly interaction: 'active' | 'passive';
	readonly preserveFocus?: boolean;
	readonly preserveVisibility?: boolean;
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
	readonly caches?: GitCaches[];
}

type EventsMapping = {
	'commit:selected': CommitSelectedEventArgs;
	'draft:selected': DraftSelectedEventArgs;
	'file:selected': FileSelectedEventArgs;
	'git:cache:reset': GitCacheResetEventArgs;
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

export class EventBus implements Disposable {
	private readonly _emitter = new EventEmitter<EventBusEvent>();

	dispose() {
		this._emitter.dispose();
	}

	fire<T extends keyof EventsMapping>(name: T, data: EventsMapping[T], options?: EventBusOptions) {
		if (canCacheEventArgs(name)) {
			_cachedEventArgs.set(name, data as CacheableEventsMapping[typeof name]);
		}
		this._emitter.fire({
			name: name,
			data: data,
			source: options?.source,
		});
	}

	fireAsync<T extends keyof EventsMapping>(name: T, data: EventsMapping[T], options?: EventBusOptions) {
		queueMicrotask(() => this.fire(name, data, options));
	}

	getCachedEventArgs<T extends keyof CacheableEventsMapping>(name: T): CacheableEventsMapping[T] | undefined {
		return _cachedEventArgs.get(name) as CacheableEventsMapping[T] | undefined;
	}

	on<T extends keyof EventsMapping>(name: T, handler: (e: EventBusEvent<T>) => void, thisArgs?: unknown) {
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
