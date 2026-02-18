import { AsyncLocalStorage } from 'async_hooks';
import type { ScopedLogger } from '../../system/logger.scope.js';

type ScopeStore = {
	current: ScopedLogger | undefined;
};

const scopeStorage = new AsyncLocalStorage<ScopeStore>();

/**
 * Runs a function within a log scope context.
 * The scope will be available via getCurrentScope() throughout the async execution.
 */
export function runInScope<T>(scope: ScopedLogger, fn: () => T): T {
	return scopeStorage.run({ current: scope }, fn);
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
 */
export function enterScope(scope: ScopedLogger): void {
	const store = scopeStorage.getStore();
	if (store != null) {
		store.current = scope;
		return;
	}

	// If there isn't an active store, create one for the current async execution chain.
	scopeStorage.enterWith({ current: scope });
}

/**
 * Exits a log scope context (for use with `using` pattern).
 * @param prevScope The scope to restore, or undefined to clear the current scope.
 * @param _scopeToExit Unused in Node.js (AsyncLocalStorage handles cleanup automatically).
 */
export function exitScope(prevScope: ScopedLogger | undefined, _scopeToExit?: ScopedLogger): void {
	// Avoid AsyncLocalStorage.disable() here, as it affects the ALS instance globally and can
	// interfere with other concurrent executions.
	const store = scopeStorage.getStore();
	if (store != null) {
		store.current = prevScope;
		return;
	}

	// If we somehow don't have a store in this async context, fall back to setting a new store.
	// Note: This won't be able to clear a store in another execution chain.
	if (prevScope != null) {
		scopeStorage.enterWith({ current: prevScope });
	}
}
