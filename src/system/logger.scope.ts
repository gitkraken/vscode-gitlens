import { getScopedCounter } from './counter.js';

export const logScopeIdGenerator = getScopedCounter();

const scopes = new Map<number, ScopedLogger>();

export interface ScopedLogger {
	readonly scopeId?: number;
	readonly prevScopeId?: number;
	readonly prefix: string;
	exitDetails?: string;
	exitFailed?: string;
}

export function clearLogScope(scopeId: number): void {
	scopes.delete(scopeId);
}

export function getLoggableScopeBlock(scopeId: number, prevScopeId?: number): string {
	return prevScopeId == null
		? `[${scopeId.toString(16).padStart(13)}]`
		: `[${prevScopeId.toString(16).padStart(5)} \u2192 ${scopeId.toString(16).padStart(5)}]`;
}

export function getLoggableScopeBlockOverride(prefix: string, suffix?: string): string {
	if (suffix == null) return `[${prefix.padEnd(13)}]`;

	return `[${prefix}${suffix.padStart(13 - prefix.length)}]`;
}

export function getScopedLogger(): ScopedLogger | undefined {
	return scopes.get(logScopeIdGenerator.current);
}

export function getNewLogScope(prefix: string, scope: ScopedLogger | boolean | undefined): ScopedLogger {
	if (scope != null && typeof scope !== 'boolean') {
		return {
			scopeId: scope.scopeId,
			prevScopeId: scope.prevScopeId,
			prefix: `${scope.prefix}${prefix}`,
		};
	}

	const prevScopeId = scope ? logScopeIdGenerator.current : undefined;
	const scopeId = logScopeIdGenerator.next();
	return {
		scopeId: scopeId,
		prevScopeId: prevScopeId,
		prefix: `${getLoggableScopeBlock(scopeId, prevScopeId)} ${prefix}`,
	};
}

export function startScopedLogger(
	prefix: string,
	scope: ScopedLogger | boolean | undefined,
): ScopedLogger & Disposable {
	const newScope = getNewLogScope(prefix, scope);
	scopes.set(newScope.scopeId!, newScope);
	return {
		...newScope,
		[Symbol.dispose]: () => clearLogScope(newScope.scopeId!),
	};
}

export function setLogScope(scopeId: number, scope: ScopedLogger): ScopedLogger {
	scope = { prevScopeId: logScopeIdGenerator.current, ...scope };
	scopes.set(scopeId, scope);
	return scope;
}

export function setLogScopeExit(scope: ScopedLogger | undefined, details: string | undefined, failed?: string): void {
	if (scope == null) return;

	if (scope.exitDetails != null && details != null) {
		scope.exitDetails += details;
	} else {
		scope.exitDetails = details;
	}

	if (failed != null) {
		if (scope.exitFailed != null) {
			scope.exitFailed += failed;
		} else {
			scope.exitFailed = failed;
		}
	}
}
