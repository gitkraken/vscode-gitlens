import { once } from './function';

export type UnifiedDisposable = { dispose: () => void } & Disposable;
export type UnifiedAsyncDisposable = { dispose: () => Promise<void> } & AsyncDisposable;

export function createDisposable(dispose: () => void, options?: { once?: boolean }): UnifiedDisposable {
	if (options?.once) {
		dispose = once(dispose);
	}

	return {
		dispose: dispose,
		[Symbol.dispose]: dispose,
	};
}

export function createAsyncDisposable(
	dispose: () => Promise<any>,
	options?: { once?: boolean },
): UnifiedAsyncDisposable {
	if (options?.once) {
		dispose = once(dispose);
	}

	return {
		dispose: dispose,
		[Symbol.asyncDispose]: dispose,
	};
}

export function mixinDisposable<T extends object>(obj: T, dispose: () => void): T & UnifiedDisposable {
	return { ...obj, ...createDisposable(dispose) };
}
