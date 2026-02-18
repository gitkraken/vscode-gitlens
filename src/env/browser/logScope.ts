import type { ScopedLogger } from '../../system/logger.scope.js';

// Browser fallback: counter-based scope tracking
// Note: This may return incorrect scope after await if other scoped methods run concurrently.
// The `using` pattern ensures LIFO disposal which works correctly, but concurrent async
// operations may see stale or incorrect scope values after await.
const scopes = new Map<number, ScopedLogger>();
let currentScopeId: number | undefined;

/**
 * Runs a function within a log scope context.
 * Note: In browser, scope tracking across async boundaries is best-effort only.
 */
export function runInScope<T>(scope: ScopedLogger, fn: () => T): T {
	const prevId = currentScopeId;
	currentScopeId = scope.scopeId;
	scopes.set(scope.scopeId!, scope);
	try {
		return fn();
	} finally {
		currentScopeId = prevId;
		scopes.delete(scope.scopeId!);
	}
}

/**
 * Gets the current log scope.
 * Note: In browser, this may be incorrect after await if other scoped methods run concurrently.
 * For reliable scope access, capture the scope immediately at method entry.
 */
export function getCurrentScope(): ScopedLogger | undefined {
	return currentScopeId != null ? scopes.get(currentScopeId) : undefined;
}

/**
 * Enters a log scope context (for use with `using` pattern).
 * Note: In browser, scope tracking across async boundaries is best-effort only.
 */
export function enterScope(scope: ScopedLogger): void {
	currentScopeId = scope.scopeId;
	scopes.set(scope.scopeId!, scope);
}

/**
 * Exits a log scope context (for use with `using` pattern).
 * @param prevScope The scope to restore, or undefined to clear the current scope.
 * @param scopeToExit Optional scope that is being exited (for cleanup). If provided,
 *                    this scope's entry will be removed from the Map regardless of currentScopeId.
 */
export function exitScope(prevScope: ScopedLogger | undefined, scopeToExit?: ScopedLogger): void {
	// Clean up the scope being exited (if provided), otherwise clean up the current scope
	const scopeIdToDelete = scopeToExit?.scopeId ?? currentScopeId;
	if (scopeIdToDelete != null) {
		scopes.delete(scopeIdToDelete);
	}
	currentScopeId = prevScope?.scopeId;
}
