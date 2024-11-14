export declare global {
	declare const DEBUG: boolean;

	export type PartialDeep<T> = T extends Record<string, unknown> ? { [K in keyof T]?: PartialDeep<T[K]> } : T;
	export type Optional<T, K extends keyof T> = Omit<T, K> & { [P in K]?: T[P] };
	export type PickPartialDeep<T, K extends keyof T> = Omit<Partial<T>, K> & { [P in K]?: Partial<T[P]> };

	export type Mutable<T> = { -readonly [P in keyof T]: T[P] };
	export type PickMutable<T, K extends keyof T> = Omit<T, K> & { -readonly [P in K]: T[P] };

	export type EntriesType<T> = T extends Record<infer K, infer V> ? [K, V] : never;

	export type ExcludeSome<T, K extends keyof T, R> = Omit<T, K> & { [P in K]-?: Exclude<T[P], R> };

	export type ExtractAll<T, U> = { [K in keyof T]: T[K] extends U ? T[K] : never };
	export type ExtractPrefixes<T extends string, SEP extends string> = T extends `${infer Prefix}${SEP}${infer Rest}`
		? Prefix | `${Prefix}${SEP}${ExtractPrefixes<Rest, SEP>}`
		: T;
	export type ExtractSome<T, K extends keyof T, R> = Omit<T, K> & { [P in K]-?: Extract<T[P], R> };

	export type RequireSome<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: T[P] };
	export type RequireSomeWithProps<T, K extends keyof T, Props extends keyof T[K]> = Omit<T, K> & {
		[P in K]-?: RequireSome<T[P], Props>;
	};

	export type AllNonNullable<T> = { [P in keyof T]-?: NonNullable<T[P]> };
	export type SomeNonNullable<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: NonNullable<T[P]> };

	export type NarrowRepo<T extends { repo?: unknown }> = ExcludeSome<T, 'repo', string | undefined>;
	export type NarrowRepos<T extends { repos?: unknown }> = ExcludeSome<T, 'repos', string | string[] | undefined>;

	export type Prefix<P extends string, T extends string, S extends string = ''> = T extends `${P}${S}${infer R}`
		? R
		: never;

	export type Replace<T, K extends keyof T, R> = Omit<T, K> & { [P in K]: R };

	export type StartsWith<P extends string, T extends string, S extends string = ''> = T extends `${P}${S}${string}`
		? T
		: never;

	export type UnwrapCustomEvent<T> = T extends CustomEvent<infer U> ? U : never;
}
