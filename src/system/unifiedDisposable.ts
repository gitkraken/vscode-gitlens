import type { Disposable as CoreDisposable } from 'vscode';

export type UnifiedDisposable = Disposable & CoreDisposable;
export type UnifiedAsyncDisposable = { dispose: () => Promise<void> } & AsyncDisposable;

export function createDisposable(dispose: () => void): UnifiedDisposable {
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
