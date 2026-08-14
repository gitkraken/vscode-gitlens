import { Uri } from 'vscode';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { Sources } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import { executeCommand } from '../../system/-webview/command.js';
import { openWorkspace } from '../../system/-webview/vscode/workspaces.js';

/** Opens/raises the Commit Graph at a worktree with its working-changes row selected — the one
 *  payload the terminal-menu and Claude-tab commands both dispatch, so the show-wip shape can't
 *  drift between them. `focus` also scopes the graph to the worktree's branch (a detached worktree
 *  just reveals without scoping) and keeps the details panel closed via `revealOnly`, matching the
 *  in-graph Focus commands. `agentSessionId` highlights that session's card in the details panel. */
export async function showWorktreeInGraph(
	container: Container,
	worktreePath: string,
	options: { source: Sources; focus?: boolean; agentSessionId?: string },
): Promise<void> {
	const branch =
		options.focus === true
			? await container.git.getRepositoryService(worktreePath).branches.getBranch()
			: undefined;

	void executeCommand('gitlens.showGraph', {
		action: 'show-wip',
		target: { sha: uncommitted, worktreePath: worktreePath },
		agentSessionId: options.agentSessionId,
		revealOnly: options.focus === true ? true : undefined,
		scopeBranch: branch != null ? { branchName: branch.name, upstreamName: branch.upstream?.name } : undefined,
		source: { source: options.source },
	});
}

export function openWorktreeInNewWindow(worktreePath: string): void {
	openWorkspace(Uri.file(worktreePath), { location: 'newWindow' });
}
