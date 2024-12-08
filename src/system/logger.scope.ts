import { getScopedCounter } from './counter';

export const logScopeIdGenerator = getScopedCounter();

const scopes = new Map<number, LogScope>();

export interface LogScope {
	readonly scopeId?: number;
	readonly prevScopeId?: number;
	readonly prefix: string;
	exitDetails?: string;
	exitFailed?: string;
}

export function clearLogScope(scopeId: number) {
	scopes.delete(scopeId);
}

export function getLoggableScopeBlock(scopeId: number, prevScopeId?: number) {
	return prevScopeId == null
		? `[${scopeId.toString(16).padStart(13)}]`
		: `[${prevScopeId.toString(16).padStart(5)} \u2192 ${scopeId.toString(16).padStart(5)}]`;
}

export function getLoggableScopeBlockOverride(prefix: string, suffix?: string) {
	if (suffix == null) return `[${prefix.padEnd(13)}]`;

	return `[${prefix}${suffix.padStart(13 - prefix.length)}]`;
}

export function getLogScope(): LogScope | undefined {
	return scopes.get(logScopeIdGenerator.current);
}

export function getNewLogScope(prefix: string, scope: LogScope | boolean | undefined): LogScope {
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

export function startLogScope(prefix: string, scope: LogScope | boolean | undefined): LogScope & Disposable {
	const newScope = getNewLogScope(prefix, scope);
	scopes.set(newScope.scopeId!, newScope);
	return {
		...newScope,
		[Symbol.dispose]: () => clearLogScope(newScope.scopeId!),
	};
}

export function setLogScope(scopeId: number, scope: LogScope) {
	scope = { prevScopeId: logScopeIdGenerator.current, ...scope };
	scopes.set(scopeId, scope);
	return scope;
}

export function setLogScopeExit(scope: LogScope | undefined, details: string | undefined, failed?: string): void {
	if (scope == null) return;

	scope.exitDetails = details;
	if (failed != null) {
		scope.exitFailed = failed;
	}
}
