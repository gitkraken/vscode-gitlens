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

/** Returns the existing object with disposable methods added */
export function mixinDisposable<T extends { dispose: () => void }>(disposable: T): T & UnifiedDisposable;
export function mixinDisposable<T extends { dispose: () => void } | undefined>(
	disposable: T,
): (T & UnifiedDisposable) | undefined;
export function mixinDisposable<T extends object & { dispose?: never }>(
	obj: T,
	dispose: () => void,
): T & UnifiedDisposable;
export function mixinDisposable<T extends (object & { dispose?: never }) | { dispose: () => void }>(
	obj: T,
	dispose?: () => void,
): (T & UnifiedDisposable) | undefined {
	if (obj == null) return undefined;

	if (dispose != null) {
		(obj as any).dispose = dispose;
		(obj as any)[Symbol.dispose] = dispose;
		return obj as T & UnifiedDisposable;
	}

	if ('dispose' in obj && obj.dispose != null) {
		(obj as any)[Symbol.dispose] = obj.dispose;
		return obj as T & UnifiedDisposable;
	}

	throw new Error('Object does not have a dispose method or a dispose function was not provided');
}

/** Returns the existing object with async disposable methods added */
export function mixinAsyncDisposable<T extends { dispose: () => Promise<any> }>(
	disposable: T,
): T & UnifiedAsyncDisposable;
export function mixinAsyncDisposable<T extends { dispose: () => Promise<any> } | undefined>(
	disposable: T,
): (T & UnifiedAsyncDisposable) | undefined;
export function mixinAsyncDisposable<T extends object & { dispose?: never }>(
	obj: T,
	dispose: () => Promise<any>,
): T & UnifiedAsyncDisposable;
export function mixinAsyncDisposable<T extends (object & { dispose?: never }) | { dispose: () => Promise<any> }>(
	obj: T,
	dispose?: () => Promise<any>,
): (T & UnifiedAsyncDisposable) | undefined {
	if (obj == null) return undefined;

	if (dispose != null) {
		(obj as any).dispose = dispose;
		(obj as any)[Symbol.asyncDispose] = dispose;
		return obj as T & UnifiedAsyncDisposable;
	}

	if ('dispose' in obj && obj.dispose != null) {
		(obj as any)[Symbol.asyncDispose] = obj.dispose;
		return obj as T & UnifiedAsyncDisposable;
	}

	throw new Error('Object does not have a dispose method or a dispose function was not provided');
}
