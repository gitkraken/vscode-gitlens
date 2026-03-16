import { Signal } from 'signal-polyfill';
import type { ReadableSignal } from './signals.js';

export interface RemoteSignalBridge<T> extends ReadableSignal<T> {
	get(): T;
	connect(remote: ReadableSignal<T>): void;
	disconnect(): void;
}

export function createRemoteSignalBridge<T>(defaultValue: T): RemoteSignalBridge<T> {
	const _local = new Signal.State<T>(defaultValue);
	const _remote = new Signal.State<ReadableSignal<T> | undefined>(undefined);

	const _computed = new Signal.Computed<T>(() => {
		const remote = _remote.get();
		return remote != null ? remote.get() : _local.get();
	});

	return {
		get: function (): T {
			return _computed.get();
		},
		connect: function (remote: ReadableSignal<T>): void {
			_remote.set(remote);
		},
		disconnect: function (): void {
			// Capture current value before disconnecting so consumers see the last known value
			const remote = _remote.get();
			if (remote != null) {
				_local.set(remote.get());
			}
			_remote.set(undefined);
		},
	};
}
