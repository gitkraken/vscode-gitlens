import type { Disposable } from 'vscode';
import { EventEmitter } from 'vscode';

export type EventBusPackage = {
	name: string;
	data?: unknown;
	source?: string;
};

export type EventBusOptions = {
	source?: string;
};

export class EventBus implements Disposable {
	private _emitter: EventEmitter<EventBusPackage>;

	constructor() {
		this._emitter = new EventEmitter();
	}

	private get event() {
		return this._emitter.event;
	}

	on(eventName: string, handler: (e: EventBusPackage) => void, thisArgs?: any, disposables?: Disposable[]) {
		return this.event(
			e => {
				if (eventName !== e.name) return;
				handler.call(thisArgs, e);
			},
			thisArgs,
			disposables,
		);
	}

	fire(name: string, data?: unknown, options?: EventBusOptions) {
		this._emitter.fire({
			name: name,
			data: data,
			source: options?.source,
		});
	}

	dispose() {
		this._emitter?.dispose();
	}
}
