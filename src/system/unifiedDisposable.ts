import { once } from './function';

export type UnifiedDisposable = { dispose: () => void } & Disposable;
export type UnifiedAsyncDisposable = { dispose: () => Promise<void> } & AsyncDisposable;

export function createDisposable(dispose: () => void, options?: { once?: boolean }): UnifiedDisposable;
export function createDisposable(
	dispose: (() => void) | undefined,
	options?: { once?: boolean },
): UnifiedDisposable | undefined;
export function createDisposable(
	dispose?: (() => void) | undefined,
	options?: { once?: boolean },
): UnifiedDisposable | undefined {
	if (dispose == null) return undefined;
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

export function mixinDisposable<T extends object>(
	obj: T,
	dispose: () => void,
	options?: { once?: boolean },
): T & UnifiedDisposable {
	return { ...obj, ...createDisposable(dispose, options) };
}

export function mixinAsyncDisposable<T extends object>(
	obj: T,
	dispose: () => Promise<any>,
	options?: { once?: boolean },
): T & UnifiedAsyncDisposable {
	return { ...obj, ...createAsyncDisposable(dispose, options) };
}
