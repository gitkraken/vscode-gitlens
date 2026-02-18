/* eslint-disable @typescript-eslint/no-unsafe-return */
import { resolveProp } from './resolver.js';

/** Keys for memoize version invalidation */
export type MemoizeVersionKey = 'providers';

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
	 * Version key for cache invalidation
	 * When invalidateMemoized(key) is called, all memoized values
	 * with this version key will be invalidated (cache miss on next call).
	 */
	version?: MemoizeVersionKey;
}

export function memoize<T extends (...arg: any) => any>(options?: MemoizeOptions<T>) {
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

		let result;
		descriptor[fnKey] = function (...args: any[]) {
			// Include version in the cache key if specified
			const versionPrefix = opts.version != null ? `v${getMemoizeVersion(opts.version)}$` : '';
			const prop = versionPrefix + resolveProp(memoizeKey, opts.resolver, ...(args as Parameters<T>));

			if (Object.hasOwn(this, prop)) {
				result = this[prop];

				return result;
			}

			result = fn.apply(this, args);
			Object.defineProperty(this, prop, {
				configurable: false,
				enumerable: false,
				writable: false,
				value: result,
			});

			return result;
		};
	};
}
