import type { Disposable, Uri } from 'vscode';
import { EventEmitter } from 'vscode';
import type { ViewsConfigKeys } from './config';
import type { GitCaches } from './git/gitProvider';
import type { GitCommit } from './git/models/commit';
import type { GitRevisionReference } from './git/models/reference';
import type { WebviewIds } from './webviews/webviewBase';
import type { WebviewViewIds } from './webviews/webviewViewBase';

export type CommitSelectedEvent = EventBusEvent<'commit:selected'>;
interface CommitSelectedEventArgs {
	readonly commit: GitRevisionReference | GitCommit;
	readonly pin?: boolean;
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

type EventBusEventMap = {
	'commit:selected': CommitSelectedEventArgs;
	'file:selected': FileSelectedEventArgs;
	'git:cache:reset': GitCacheResetEventArgs;
};

interface EventBusEvent<T extends keyof EventBusEventMap = keyof EventBusEventMap> {
	name: T;
	data: EventBusEventMap[T];
	source?: EventBusSource | undefined;
}

export type EventBusSource =
	| 'gitlens.rebase'
	| `gitlens.${WebviewIds}`
	| `gitlens.views.${WebviewViewIds}`
	| `gitlens.views.${ViewsConfigKeys}`;

export type EventBusOptions = {
	source?: EventBusSource;
};

export class EventBus implements Disposable {
	private readonly _emitter = new EventEmitter<EventBusEvent>();
	private get event() {
		return this._emitter.event;
	}

	dispose() {
		this._emitter.dispose();
	}

	fire<T extends keyof EventBusEventMap>(name: T, data: EventBusEventMap[T], options?: EventBusOptions) {
		this._emitter.fire({
			name: name,
			data: data,
			source: options?.source,
		});
	}

	fireAsync<T extends keyof EventBusEventMap>(name: T, data: EventBusEventMap[T], options?: EventBusOptions) {
		queueMicrotask(() => this.fire(name, data, options));
	}

	on<T extends keyof EventBusEventMap>(
		eventName: T,
		handler: (e: EventBusEvent<T>) => void,
		thisArgs?: unknown,
		disposables?: Disposable[],
	) {
		return this.event(
			// eslint-disable-next-line prefer-arrow-callback
			function (e) {
				if (eventName !== e.name) return;
				handler.call(thisArgs, e as EventBusEvent<T>);
			},
			thisArgs,
			disposables,
		);
	}
}
