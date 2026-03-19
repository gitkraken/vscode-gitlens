import { AsyncLocalStorage } from 'async_hooks';
import type { ScopedLogger } from '../../logger.scoped.js';

type ScopeStore = {
	current: ScopedLogger | undefined;
	/** Parent store from the previous `enterWith`, used to propagate scope changes to ancestor async contexts */
	prev: ScopeStore | undefined;
};

const scopeStorage = new AsyncLocalStorage<ScopeStore>();

/**
 * Runs a function within a log scope context.
 * The scope will be available via getCurrentScope() throughout the async execution.
 */
export function runInScope<T>(scope: ScopedLogger, fn: () => T): T {
	return scopeStorage.run({ current: scope, prev: undefined }, fn);
}

/**
 * Gets the current log scope from AsyncLocalStorage.
 * Works correctly across async boundaries.
 */
export function getCurrentScope(): ScopedLogger | undefined {
	return scopeStorage.getStore()?.current;
}

/**
 * Enters a log scope context (for use with `using` pattern).
 * The scope will be available via getCurrentScope() throughout async execution.
 *
 * Always creates a new store object via `enterWith` rather than mutating an existing store.
 * This ensures concurrent async operations each retain their own store snapshot — existing
 * async continuations that captured the previous store are unaffected by new `enterWith` calls.
 * The previous store is linked via `prev` so that `exitScope` can propagate cleanup to
 * parent async contexts.
 */
export function enterScope(scope: ScopedLogger): void {
	const prevStore = scopeStorage.getStore();
	scopeStorage.enterWith({ current: scope, prev: prevStore });
}

/**
 * Exits a log scope context (for use with `using` pattern).
 *
 * Propagates the restored scope to all ancestor stores so parent async contexts
 * (which captured older store snapshots) see the cleanup. Then creates a fresh store
 * for the current execution context going forward.
 *
 * @param prevScope The scope to restore, or undefined to clear the current scope.
 * @param _scopeToExit Unused in Node.js (AsyncLocalStorage handles cleanup automatically).
 */
export function exitScope(prevScope: ScopedLogger | undefined, _scopeToExit?: ScopedLogger): void {
	// Walk the ancestor chain and propagate the restored scope to all parent stores.
	// Parent async contexts captured these older store objects and read `.current` on resume,
	// so they need to see the updated value.
	let store = scopeStorage.getStore();
	while (store != null) {
		store.current = prevScope;
		store = store.prev;
	}
	scopeStorage.enterWith({ current: prevScope, prev: scopeStorage.getStore()?.prev });
}
