import { signal as litSignal } from '@lit-labs/signals';
import { Signal } from 'signal-polyfill';
import type { ReadableSignal } from './signals.js';

export type ResourceStatus = 'idle' | 'loading' | 'success' | 'error';

export interface Resource<T, TArgs extends unknown[] = []> {
	readonly value: ReadableSignal<T>;
	readonly loading: ReadableSignal<boolean>;
	readonly error: ReadableSignal<string | undefined>;
	readonly status: ReadableSignal<ResourceStatus>;

	fetch(...args: TArgs): Promise<void>;
	refetch(): Promise<void>;
	mutate(value: T): void;
	cancel(): void;
	dispose(): void;
}

export interface ResourceOptions<T> {
	initialValue?: T;
	cancelPrevious?: boolean;
}

export function createResource<T, TArgs extends unknown[] = []>(
	fetcher: (signal: AbortSignal, ...args: TArgs) => Promise<T>,
	options?: ResourceOptions<T>,
): Resource<T, TArgs> {
	const cancelPrevious = options?.cancelPrevious ?? true;

	const _value = litSignal<T>(options?.initialValue as T);
	const _loading = litSignal(false);
	const _error = litSignal<string | undefined>(undefined);
	const _hasResolved = litSignal(false);
	const _status = new Signal.Computed<ResourceStatus>(() => {
		if (_loading.get()) return 'loading';
		if (_error.get() != null) return 'error';
		if (_hasResolved.get()) return 'success';
		return 'idle';
	});

	let _controller: AbortController | undefined;
	let _lastArgs: TArgs | undefined;
	let _disposed = false;
	let _requestId = 0;
	let _currentRequestId = 0;

	function cancel(): void {
		if (_controller != null) {
			_controller.abort();
			_controller = undefined;
		}
		_loading.set(false);
	}

	async function runFetch(...args: TArgs): Promise<void> {
		if (_disposed) return;

		if (cancelPrevious) {
			cancel();
		}

		_lastArgs = args;
		const controller = new AbortController();
		const requestId = ++_requestId;
		_currentRequestId = requestId;
		_controller = controller;

		_loading.set(true);
		_error.set(undefined);

		try {
			const result = await fetcher(controller.signal, ...args);
			if (controller.signal.aborted || requestId !== _currentRequestId) return;
			_value.set(result);
			_hasResolved.set(true);
		} catch (ex) {
			if (controller.signal.aborted || requestId !== _currentRequestId) return;
			_error.set(ex instanceof Error ? ex.message : String(ex));
		} finally {
			if (_controller === controller) {
				_controller = undefined;
				_loading.set(false);
			}
		}
	}

	async function refetch(): Promise<void> {
		if (_lastArgs == null) return;
		return runFetch(..._lastArgs);
	}

	function mutate(value: T): void {
		if (_disposed) return;
		_value.set(value);
		_error.set(undefined);
		_hasResolved.set(true);
	}

	function dispose(): void {
		_disposed = true;
		cancel();
	}

	return {
		value: _value,
		loading: _loading,
		error: _error,
		status: { get: () => _status.get() },
		fetch: runFetch,
		refetch: refetch,
		mutate: mutate,
		cancel: cancel,
		dispose: dispose,
	};
}
