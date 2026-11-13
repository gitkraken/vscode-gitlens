import { exhaustiveArray } from '@gitlens/utils/array.js';
import type { Uri } from '@gitlens/utils/uri.js';
import type { GitProvider, GitProviderDescriptor } from './providers/provider.js';

/**
 * A repo-scoped view of a {@link GitProvider}'s sub-providers.
 *
 * Every sub-provider method has its `repoPath` parameter auto-injected,
 * so callers don't need to pass the repository path repeatedly.
 *
 * Created lazily by {@link GitService.forRepo} and cached
 * for proxy reuse. The service trusts the caller — if the path isn't
 * a real repository, git commands will fail naturally.
 *
 * @example
 * ```typescript
 * const repo = service.forRepo('/path/to/repo');
 * const branches = await repo.branches.getBranches(); // repoPath auto-injected
 * const status = await repo.status.getStatus();
 * ```
 */
export interface RepositoryService {
	/** Normalized path or URI-string identifying the repository root */
	readonly path: string;
	/** Descriptor of the provider that manages this repository */
	readonly provider: GitProviderDescriptor;

	/** Resolves a relative path within this repository to an absolute URI */
	getAbsoluteUri(relativePath: string): Uri;

	/**
	 * Monotonic counter tracking working tree filesystem changes.
	 * Used by `GitCommit.hasFullDetails()` for uncommitted commit staleness.
	 * Returns `undefined` when no watch service is configured (headless/test).
	 */
	readonly etagWorkingTree: number | undefined;

	// Required sub-providers (repoPath auto-injected)
	readonly branches: SubProviderForRepo<GitProvider['branches']>;
	readonly commits: SubProviderForRepo<GitProvider['commits']>;
	readonly config: SubProviderForRepo<GitProvider['config']>;
	readonly contributors: SubProviderForRepo<GitProvider['contributors']>;
	readonly diff: SubProviderForRepo<GitProvider['diff']>;
	readonly graph: SubProviderForRepo<GitProvider['graph']>;
	readonly refs: SubProviderForRepo<GitProvider['refs']>;
	readonly remotes: SubProviderForRepo<GitProvider['remotes']>;
	readonly revision: SubProviderForRepo<GitProvider['revision']>;
	readonly status: SubProviderForRepo<GitProvider['status']>;
	readonly tags: SubProviderForRepo<GitProvider['tags']>;

	// Optional sub-providers
	readonly blame?: SubProviderForRepo<NonNullable<GitProvider['blame']>>;
	readonly maintenance?: SubProviderForRepo<NonNullable<GitProvider['maintenance']>>;
	readonly ops?: SubProviderForRepo<NonNullable<GitProvider['ops']>>;
	readonly patch?: SubProviderForRepo<NonNullable<GitProvider['patch']>>;
	readonly pausedOps?: SubProviderForRepo<NonNullable<GitProvider['pausedOps']>>;
	readonly staging?: SubProviderForRepo<NonNullable<GitProvider['staging']>>;
	readonly stash?: SubProviderForRepo<NonNullable<GitProvider['stash']>>;
	readonly worktrees?: SubProviderForRepo<NonNullable<GitProvider['worktrees']>>;
}

let _repositoryServiceResolver: ((repoPath: string) => RepositoryService | undefined) | undefined;

/** Clears the global repository resolver */
export function clearGlobalRepositoryServiceResolver(): void {
	_repositoryServiceResolver = undefined;
}

/**
 * Returns a repo-scoped {@link RepositoryService} for the given path.
 * Returns undefined if no resolver is configured or the path is unrecognized.
 *
 * @warning This function depends on {@link setGlobalRepositoryServiceResolver} being called at startup.
 * If called before configuration, it will return undefined. Ensure proper initialization order.
 */
export function getRepositoryService(repoPath: string): RepositoryService | undefined {
	return _repositoryServiceResolver?.(repoPath);
}

/**
 * Sets a global repository resolver for models
 * Call this at application startup to enable model-level
 * repository access (e.g., {@link GitWorktree.hasWorkingChanges}).
 * @internal Called by {@link GitService} constructor.
 */
export function setGlobalRepositoryServiceResolver(
	resolver: (repoPath: string) => RepositoryService | undefined,
): void {
	_repositoryServiceResolver = resolver;
}

/**
 * Utility for creating repo-scoped sub-provider wrappers.
 *
 * **Contract:** Every method on a sub-provider must accept `repoPath: string` as its
 * first parameter. The proxy auto-injects `repoPath` so callers don't have to pass it
 * repeatedly. Methods that don't take `repoPath` (e.g. `clone`) belong on `GitProvider`
 * directly, not on a sub-provider interface.
 *
 * @example
 * ```typescript
 * const branches = createSubProviderProxyForRepo(provider.branches, '/repo/path');
 * // Now: branches.getBranch('main') instead of provider.branches.getBranch('/repo/path', 'main')
 * ```
 */

// Note: OmitFirstArg handles function overloads (up to 4 deep).
// This is needed because some sub-provider methods have overloaded signatures.
// The `First` type parameter constrains what the first argument must extend —
// pass `string` to enforce that every method takes `repoPath: string` as its first parameter.
type OmitFirstArg<F, First = any> = F extends {
	(first: First, ...args: infer A1): infer R1;
	(first: First, ...args: infer A2): infer R2;
	(first: First, ...args: infer A3): infer R3;
	(first: First, ...args: infer A4): infer R4;
}
	? ((...args: A1) => R1) & ((...args: A2) => R2) & ((...args: A3) => R3) & ((...args: A4) => R4)
	: F extends {
				(first: First, ...args: infer A1): infer R1;
				(first: First, ...args: infer A2): infer R2;
				(first: First, ...args: infer A3): infer R3;
		  }
		? ((...args: A1) => R1) & ((...args: A2) => R2) & ((...args: A3) => R3)
		: F extends {
					(first: First, ...args: infer A1): infer R1;
					(first: First, ...args: infer A2): infer R2;
			  }
			? ((...args: A1) => R1) & ((...args: A2) => R2)
			: F extends {
						(first: First, ...args: infer A1): infer R1;
				  }
				? (...args: A1) => R1
				: never;

/**
 * Transforms a sub-provider type by removing the first `repoPath` parameter
 * from every method signature. Used to create repo-scoped views of sub-providers.
 *
 * Passes `string` as the `First` constraint to `OmitFirstArg`, which enforces that
 * every method on the sub-provider takes `string` (i.e. `repoPath`) as its first
 * parameter. Methods that don't will produce `never`, causing a compile error at call sites.
 *
 * Uses `NonNullable` before the conditional check so that optional methods
 * (whose type includes `| undefined`) are still matched and transformed.
 * Property optionality is preserved automatically by the mapped-type `[K in keyof T]`.
 */
export type SubProviderForRepo<T> = {
	[K in keyof T]: NonNullable<T[K]> extends (...args: any[]) => any ? OmitFirstArg<NonNullable<T[K]>, string> : T[K];
};

/** The names of {@link RepositoryService}'s sub-providers */
export type SubProviderName = Exclude<
	keyof RepositoryService,
	'path' | 'provider' | 'getAbsoluteUri' | 'etagWorkingTree'
>;

/** The return types of a method's signatures (up to 4 overloads, as {@link OmitFirstArg}) */
type ReturnTypesOf<F> = F extends {
	(...args: never[]): infer R1;
	(...args: never[]): infer R2;
	(...args: never[]): infer R3;
	(...args: never[]): infer R4;
}
	? R1 | R2 | R3 | R4
	: F extends (...args: never[]) => infer R
		? R
		: never;

/** The members of `R` that are not a plain `Promise`: not one at all, or one carrying more (a cancel method, say) */
type NotPlainPromise<R> = R extends Promise<infer V> ? ([Promise<V>] extends [R] ? never : R) : R;

/**
 * The methods of sub-provider `T` that must not wait on a registration (see `Cache.setRepoPathRegistrar`): every one
 * whose signatures answer anything other than a plain `Promise` (a value, `void`, a union with one, an async
 * iterable), since wrapping it in `.then` would change what it answers
 */
type CallThroughMethodsOf<T> = {
	[K in keyof T]-?: NonNullable<T[K]> extends (...args: never[]) => unknown
		? [NotPlainPromise<ReturnTypesOf<NonNullable<T[K]>>>] extends [never]
			? never
			: K
		: never;
}[keyof T];

/**
 * Per sub-provider, the methods that call straight through while their checkout's registration is in flight; every
 * other method waits on it. Each list must name exactly the sub-provider's {@link CallThroughMethodsOf}, which the
 * build checks.
 */
export const subProviderCallThroughMethods: { readonly [K in SubProviderName]: ReadonlySet<string> } = {
	branches: new Set(exhaustiveArray<CallThroughMethodsOf<GitProvider['branches']>>()([])),
	commits: new Set(exhaustiveArray<CallThroughMethodsOf<GitProvider['commits']>>()([])),
	config: new Set<string>([
		...exhaustiveArray<CallThroughMethodsOf<GitProvider['config']>>()(['getSigningConfigFlags']),
		// What a registrar resolves the git dir it registers with: waiting would wait on its own registration
		'getGitDir',
		'getRepositoryInfo',
		'resolveGitDirWithoutGit',
	]),
	contributors: new Set(exhaustiveArray<CallThroughMethodsOf<GitProvider['contributors']>>()([])),
	diff: new Set(exhaustiveArray<CallThroughMethodsOf<GitProvider['diff']>>()([])),
	graph: new Set(
		exhaustiveArray<CallThroughMethodsOf<GitProvider['graph']>>()(['searchGraph', 'continueSearchGraph']),
	),
	refs: new Set(exhaustiveArray<CallThroughMethodsOf<GitProvider['refs']>>()([])),
	remotes: new Set(exhaustiveArray<CallThroughMethodsOf<GitProvider['remotes']>>()([])),
	revision: new Set(exhaustiveArray<CallThroughMethodsOf<GitProvider['revision']>>()([])),
	status: new Set(exhaustiveArray<CallThroughMethodsOf<GitProvider['status']>>()([])),
	tags: new Set(exhaustiveArray<CallThroughMethodsOf<GitProvider['tags']>>()([])),
	blame: new Set(exhaustiveArray<CallThroughMethodsOf<NonNullable<GitProvider['blame']>>>()([])),
	maintenance: new Set(exhaustiveArray<CallThroughMethodsOf<NonNullable<GitProvider['maintenance']>>>()(['request'])),
	ops: new Set(exhaustiveArray<CallThroughMethodsOf<NonNullable<GitProvider['ops']>>>()(['scheduleIndexRefresh'])),
	patch: new Set(exhaustiveArray<CallThroughMethodsOf<NonNullable<GitProvider['patch']>>>()([])),
	pausedOps: new Set(exhaustiveArray<CallThroughMethodsOf<NonNullable<GitProvider['pausedOps']>>>()([])),
	staging: new Set(exhaustiveArray<CallThroughMethodsOf<NonNullable<GitProvider['staging']>>>()([])),
	stash: new Set(exhaustiveArray<CallThroughMethodsOf<NonNullable<GitProvider['stash']>>>()([])),
	worktrees: new Set(
		exhaustiveArray<CallThroughMethodsOf<NonNullable<GitProvider['worktrees']>>>()(['getWorktreesDefaultUri']),
	),
};

/**
 * Creates a repo-scoped wrapper for a sub-provider.
 * Returns a plain object where every method is pre-bound with `repoPath` as the first argument.
 *
 * Every method on the sub-provider must declare `repoPath: string` as its FIRST parameter.
 * The proxy automatically injects `repoPath` as the first argument to all method calls.
 * Operations that don't take `repoPath` (like `clone`) belong on `GitProvider` directly.
 *
 * With `registration`, each call first asks `ensureRegistered` (see `GitProvider.ensureRegistered`); while it answers
 * a promise, a method not in `callThrough` starts once it settles, and one in it starts at once.
 *
 * @param target The sub-provider to wrap
 * @param repoPath The repository path to auto-inject
 * @param registration How to ask that `repoPath` be registered, and the methods that must not wait on it
 * @returns A wrapped sub-provider where repoPath is pre-bound to all methods
 */
export function createSubProviderProxyForRepo<T extends object>(
	target: T,
	repoPath: string,
	registration?: { ensureRegistered: () => Promise<void> | undefined; callThrough: ReadonlySet<string> },
): SubProviderForRepo<T> {
	const bound: Record<string | symbol, unknown> = Object.create(null);

	let proto: object | null = target;
	while (proto != null && proto !== Object.prototype) {
		for (const key of Reflect.ownKeys(proto)) {
			if (key === 'constructor' || key in bound) continue;

			const desc = Object.getOwnPropertyDescriptor(proto, key);
			if (desc?.value != null && typeof desc.value === 'function') {
				const fn = desc.value as (...args: unknown[]) => unknown;
				bound[key] = bindMethod(target, repoPath, key, fn, registration);
			}
		}
		proto = Object.getPrototypeOf(proto) as object | null;
	}

	return bound as unknown as SubProviderForRepo<T>;
}

function bindMethod(
	target: object,
	repoPath: string,
	key: string | symbol,
	fn: (...args: unknown[]) => unknown,
	registration: { ensureRegistered: () => Promise<void> | undefined; callThrough: ReadonlySet<string> } | undefined,
): (...args: unknown[]) => unknown {
	if (registration == null) return (...args: unknown[]) => fn.call(target, repoPath, ...args);

	const { ensureRegistered } = registration;
	if (typeof key !== 'string' || registration.callThrough.has(key)) {
		return (...args: unknown[]) => {
			void ensureRegistered();
			return fn.call(target, repoPath, ...args);
		};
	}

	return (...args: unknown[]) => {
		const pending = ensureRegistered();
		return pending != null
			? pending.then(() => fn.call(target, repoPath, ...args))
			: fn.call(target, repoPath, ...args);
	};
}
