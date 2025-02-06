import type { Disposable as CoreDisposable } from 'vscode';
import { once } from './function';

export type UnifiedDisposable = Disposable & CoreDisposable;
export type UnifiedAsyncDisposable = { dispose: () => Promise<void> } & AsyncDisposable;

export function createDisposable(dispose: () => void, options?: { once: boolean }): UnifiedDisposable {
	if (options?.once) {
		dispose = once(dispose);
	}

	return {
		dispose: dispose,
		[Symbol.dispose]: dispose,
	};
}

export function createAsyncDisposable(dispose: () => Promise<any>): UnifiedAsyncDisposable {
	return {
		dispose: dispose,
		[Symbol.asyncDispose]: dispose,
	};
}

export function mixinDisposable<T extends object>(obj: T, dispose: () => void): T & UnifiedDisposable {
	return { ...obj, ...createDisposable(dispose) };
}
