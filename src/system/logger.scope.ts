import { getScopedCounter } from './counter';

export const logScopeIdGenerator = getScopedCounter();

const scopes = new Map<number, LogScope>();

export interface LogScope {
	readonly scopeId?: number;
	readonly prefix: string;
	exitDetails?: string;
	exitFailed?: string;
}

export function clearLogScope(scopeId: number) {
	scopes.delete(scopeId);
}

export function getLogScope(): LogScope | undefined {
	return scopes.get(logScopeIdGenerator.current);
}

export function getNewLogScope(prefix: string, scope?: LogScope | undefined): LogScope {
	if (scope != null) return { scopeId: scope.scopeId, prefix: `${scope.prefix}${prefix}` };

	const scopeId = logScopeIdGenerator.next();
	return {
		scopeId: scopeId,
		prefix: `[${String(scopeId).padStart(5)}] ${prefix}`,
	};
}

export function setLogScope(scopeId: number, scope: LogScope) {
	scopes.set(scopeId, scope);
}

export function setLogScopeExit(scope: LogScope | undefined, details: string | undefined, failed?: string): void {
	if (scope == null) return;

	scope.exitDetails = details;
	if (failed != null) {
		scope.exitFailed = failed;
	}
}
