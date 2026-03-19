import type { Branded } from './brand.js';

/** Makes all properties of T mutable (removes readonly) */
export type Mutable<T> = { -readonly [P in keyof T]: T[P] };

/** Extracts all properties of T whose values extend U, mapping non-matching to never */
export type ExtractAll<T, U> = { [K in keyof T]: T[K] extends U ? T[K] : never };

/** Makes some properties of T required */
export type RequireSome<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: T[P] };

/** Makes some sub-properties of a required property required */
export type RequireSomeWithProps<T, K extends keyof T, Props extends keyof T[K]> = Omit<T, K> & {
	[P in K]-?: RequireSome<T[P], Props>;
};

export type Shape<T> = T extends ((...args: any[]) => any) | RegExp
	? never
	: T extends Date | Promise<any>
		? T
		: T extends Map<infer K, infer V>
			? [Shape<K>, Shape<V>][]
			: T extends Set<infer U>
				? Shape<U>[]
				: T extends Branded<infer U, any>
					? U
					: T extends any[]
						? Shape<T[number]>[]
						: T extends object
							? { [K in keyof T as T[K] extends (...args: any[]) => any ? never : K]: Shape<T[K]> }
							: T;
