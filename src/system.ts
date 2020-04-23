'use strict';

declare global {
	export type PartialDeep<T> = T extends object ? { [K in keyof T]?: PartialDeep<T[K]> } : T;
	export type PickPartialDeep<T, K extends keyof T> = Omit<Partial<T>, K> & { [P in K]?: Partial<T[P]> };

	export type Mutable<T> = { -readonly [P in keyof T]: T[P] };
	export type PickMutable<T, K extends keyof T> = Omit<T, K> & { -readonly [P in K]: T[P] };

	export type ExcludeSome<T, K extends keyof T, R> = Omit<T, K> & { [P in K]-?: Exclude<T[P], R> };
	export type ExtractSome<T, K extends keyof T, R> = Omit<T, K> & { [P in K]-?: Extract<T[P], R> };
	export type RequireSome<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: T[P] };

	export type AllNonNullable<T> = { [P in keyof T]-?: NonNullable<T[P]> };
	export type SomeNonNullable<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: NonNullable<T[P]> };

	export type NarrowRepo<T extends { repo?: unknown }> = ExcludeSome<T, 'repo', string | undefined>;
	export type NarrowRepos<T extends { repos?: unknown }> = ExcludeSome<T, 'repos', string | string[] | undefined>;
}

export * from './system/array';
export * from './system/date';
export * from './system/decorators/gate';
export * from './system/decorators/log';
export * from './system/decorators/memoize';
export * from './system/decorators/timeout';
export * from './system/function';
export * from './system/iterable';
export * from './system/object';
export * from './system/promise';
export * from './system/searchTree';
export * from './system/string';
export * from './system/version';
