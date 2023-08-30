import type { Disposable, Uri } from 'vscode';
import { EventEmitter } from 'vscode';
import type { ViewsConfigKeys } from './config';
import type { CustomEditorIds, WebviewIds, WebviewViewIds } from './constants';
import type { GitCaches } from './git/gitProvider';
import type { GitCommit } from './git/models/commit';
import type { LocalPatch } from './git/models/patch';
import type { GitRevisionReference } from './git/models/reference';
import type { CloudPatch } from './plus/patches/cloudPatchService';

export type CommitSelectedEvent = EventBusEvent<'commit:selected'>;
interface CommitSelectedEventArgs {
	readonly commit: GitRevisionReference | GitCommit;
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

export type PatchSelectedEvent = EventBusEvent<'patch:selected'>;
interface PatchSelectedEventArgs {
	readonly patch: LocalPatch | CloudPatch;
	readonly interaction: 'active' | 'passive';
	readonly preserveFocus?: boolean;
	readonly preserveVisibility?: boolean;
}

type EventsMapping = {
	'commit:selected': CommitSelectedEventArgs;
	'file:selected': FileSelectedEventArgs;
	'git:cache:reset': GitCacheResetEventArgs;
	'patch:selected': PatchSelectedEventArgs;
};

interface EventBusEvent<T extends keyof EventsMapping = keyof EventsMapping> {
	name: T;
	data: EventsMapping[T];
	source?: EventBusSource | undefined;
}

export type EventBusSource = CustomEditorIds | WebviewIds | WebviewViewIds | `gitlens.views.${ViewsConfigKeys}`;

export type EventBusOptions = {
	source?: EventBusSource;
};

type CacheableEventsMapping = {
	'commit:selected': CommitSelectedEventArgs;
	'file:selected': FileSelectedEventArgs;
	'patch:selected': PatchSelectedEventArgs;
};

const _cacheableEventNames = new Set<keyof CacheableEventsMapping>([
	'commit:selected',
	'file:selected',
	'patch:selected',
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

	on<T extends keyof EventsMapping>(
		name: T,
		handler: (e: EventBusEvent<T>) => void,
		thisArgs?: unknown,
		disposables?: Disposable[],
	) {
		return this._emitter.event(
			// eslint-disable-next-line prefer-arrow-callback
			function (e) {
				if (name !== e.name) return;
				handler.call(thisArgs, e as EventBusEvent<T>);
			},
			thisArgs,
			disposables,
		);
	}
}

function canCacheEventArgs(name: keyof EventsMapping): name is keyof CacheableEventsMapping {
	return _cacheableEventNames.has(name as keyof CacheableEventsMapping);
}
