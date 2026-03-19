/* eslint-disable @typescript-eslint/no-unsafe-return */
import { resolveProp } from './resolver.js';

/** Keys for memoize version invalidation */
export type MemoizeVersionKey = 'providers';

interface MemoizeVersionedEntry {
	version: number;
	value: unknown;
}

const versions = new Map<MemoizeVersionKey, number>();

function getMemoizeVersion(key: MemoizeVersionKey): number {
	return versions.get(key) ?? 0;
}

/** Invalidates all memoized values that depend on the given version key */
export function invalidateMemoized(key: MemoizeVersionKey): void {
	versions.set(key, (versions.get(key) ?? 0) + 1);
}

export interface MemoizeOptions<T extends (...arg: any) => any> {
	/** Custom resolver for generating cache keys from arguments */
	resolver?: (...args: Parameters<T>) => string;
	/**
	 * Version key for cache invalidation.
	 * When invalidateMemoized(key) is called, all memoized values
	 * with this version key will be invalidated (cache miss on next call).
	 */
	version?: MemoizeVersionKey;
}

export function memoize(
	options?: Omit<MemoizeOptions<any>, 'resolver'>,
): (_target: any, key: string, descriptor: PropertyDescriptor) => void;
export function memoize<T extends (...args: any[]) => any>(
	options?: MemoizeOptions<T>,
): (_target: any, key: string, descriptor: TypedPropertyDescriptor<T>) => void;
export function memoize<T extends (...args: any[]) => any>(
	options?: MemoizeOptions<T>,
): (_target: any, key: string, descriptor: PropertyDescriptor) => void {
	const opts = options ?? {};

	return (_target: any, key: string, descriptor: PropertyDescriptor & Record<string, any>): void => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
		let fn: Function | undefined;
		let fnKey: string | undefined;

		if (typeof descriptor.value === 'function') {
			fn = descriptor.value;
			fnKey = 'value';
		} else if (typeof descriptor.get === 'function') {
			fn = descriptor.get;
			fnKey = 'get';
		} else {
			throw new Error('Not supported');
		}

		if (fn == null) throw new Error('Not supported');

		const memoizeKey = `$memoize$${key}`;

		const resolver: MemoizeOptions<T>['resolver'] | undefined = 'resolver' in opts ? opts.resolver : undefined;
		const versioned = opts.version != null;

		let result;
		descriptor[fnKey] = function (...args: any[]) {
			const prop = resolveProp(memoizeKey, resolver, ...(args as Parameters<T>));
			const version = versioned ? getMemoizeVersion(opts.version!) : undefined;

			if (Object.hasOwn(this, prop)) {
				const cached = this[prop];
				if (versioned) {
					const entry = cached as MemoizeVersionedEntry;
					if (entry.version === version) {
						return entry.value;
					}
				} else {
					return cached;
				}
			}

			result = fn.apply(this, args);
			// Note: rejected promises are cached like any other result — this prevents
			// hammering a failing source on every call. If auto-invalidation on rejection
			// is needed, add a configurable option here.
			Object.defineProperty(this, prop, {
				configurable: true,
				enumerable: false,
				writable: versioned,
				value: versioned ? { version: version, value: result } : result,
			});

			return result;
		};
	};
}
