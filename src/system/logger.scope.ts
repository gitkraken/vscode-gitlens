const maxSmallIntegerV8 = 2 ** 30; // Max number that can be stored in V8's smis (small integers)

const scopes = new Map<number, LogScope>();
let scopeCounter = 0;

export interface LogScope {
	readonly scopeId?: number;
	readonly prefix: string;
	exitDetails?: string;
}

export function clearLogScope(scopeId: number) {
	scopes.delete(scopeId);
}

export function getLogScope(): LogScope | undefined {
	return scopes.get(scopeCounter);
}

export function getNewLogScope(prefix: string): LogScope {
	const scopeId = getNextLogScopeId();
	return {
		scopeId: scopeId,
		prefix: `[${String(scopeId).padStart(5)}] ${prefix}`,
	};
}

export function getLogScopeId(): number {
	return scopeCounter;
}

export function getNextLogScopeId(): number {
	if (scopeCounter === maxSmallIntegerV8) {
		scopeCounter = 0;
	}
	return ++scopeCounter;
}

export function setLogScope(scopeId: number, scope: LogScope) {
	scopes.set(scopeId, scope);
}
