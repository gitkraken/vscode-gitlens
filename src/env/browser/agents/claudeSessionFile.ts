export function classifyClaudeSessionHost(
	_pid: number,
	_sessionsDir?: string,
): Promise<'extension' | 'cli' | undefined> {
	return Promise.resolve(undefined);
}

export interface LiveClaudeSession {
	sessionId: string;
	pid?: number;
	cwd?: string;
	kind?: string;
	waitingFor?: string;
	status?: string;
	state?: string;
}

export function getLiveClaudeSessions(_command?: string): Promise<ReadonlyMap<string, LiveClaudeSession>> {
	return Promise.resolve(new Map());
}
