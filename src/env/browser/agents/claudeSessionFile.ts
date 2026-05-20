export function classifyClaudeSessionHost(
	_pid: number,
	_sessionsDir?: string,
): Promise<'extension' | 'cli' | undefined> {
	return Promise.resolve(undefined);
}
