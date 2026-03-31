import type { Uri } from 'vscode';
import { basename } from '@gitlens/utils/path.js';
import type { AgentSession } from './provider.js';

/**
 * Builds a map from branch name to matching agent sessions.
 * Optionally filters to sessions whose `workspacePath` matches the given path.
 */
export function getSessionsByBranch(
	sessions: readonly AgentSession[],
	workspacePath?: string,
): Map<string, AgentSession[]> {
	const map = new Map<string, AgentSession[]>();
	for (const session of sessions) {
		if (session.branch == null || session.branch === 'HEAD') continue;
		if (session.isSubagent) continue;
		if (workspacePath != null && session.workspacePath !== workspacePath) continue;

		let list = map.get(session.branch);
		if (list == null) {
			list = [];
			map.set(session.branch, list);
		}
		list.push(session);
	}
	return map;
}

/**
 * Finds agent sessions matching a specific branch, with optional worktree URI cross-check.
 * When `worktreeUri` is provided, sessions are further filtered to those whose
 * `worktreeName` matches the basename of the worktree's filesystem path.
 */
export function findSessionsForBranch(
	sessions: readonly AgentSession[],
	branchName: string,
	worktreeUri?: Uri,
): AgentSession[] {
	const results: AgentSession[] = [];
	for (const session of sessions) {
		if (session.branch !== branchName) continue;
		if (session.isSubagent) continue;

		if (worktreeUri != null && session.worktreeName != null) {
			if (session.worktreeName !== basename(worktreeUri.fsPath)) continue;
		}

		results.push(session);
	}
	return results;
}
