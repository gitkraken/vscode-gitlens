import { Uri } from 'vscode';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { Sources } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import { executeCommand } from '../../system/-webview/command.js';
import { openWorkspace } from '../../system/-webview/vscode/workspaces.js';

/** Opens/raises the Commit Graph at a worktree with its working-changes row selected — the one
 *  payload the terminal-menu and Claude-tab commands both dispatch, so the show-wip shape can't
 *  drift between them. `focus` also Scopes the graph onto the worktree (a detached worktree just
 *  reveals without scoping) and keeps the details panel closed via `revealOnly`. `scopeBranch` always
 *  ships; the webview's `graph.scopeBehavior` setting decides whether scoping also focuses it. The
 *  origin ships for home too, deliberately: the webview turns a gesture on the graph's own home worktree
 *  into "exit any scope + plain focus" rather than "scope to home", matching the in-graph gestures on
 *  that row. `agentSessionId` highlights that session's card in the details panel. */
export async function showWorktreeInGraph(
	container: Container,
	worktreePath: string,
	options: { source: Sources; focus?: boolean; agentSessionId?: string },
): Promise<void> {
	// A detached HEAD's `getBranch()` still returns a synthetic (`(sha…)`-named) branch object — not a
	// real branch to focus, so it's treated the same as "no branch" here: a plain reveal, no scope/rebind.
	const branch =
		options.focus === true
			? await container.git.getRepositoryService(worktreePath).branches.getBranch()
			: undefined;
	const scopeBranch = branch != null && !branch.detached ? branch : undefined;

	void executeCommand('gitlens.showGraph', {
		action: 'show-wip',
		target: { sha: uncommitted, worktreePath: worktreePath },
		agentSessionId: options.agentSessionId,
		revealOnly: options.focus === true ? true : undefined,
		scopeBranch:
			scopeBranch != null
				? { branchName: scopeBranch.name, upstreamName: scopeBranch.upstream?.name }
				: undefined,
		scopeOrigin: scopeBranch != null ? { kind: 'worktree', path: worktreePath } : undefined,
		source: { source: options.source },
	});
}

export function openWorktreeInNewWindow(worktreePath: string): void {
	openWorkspace(Uri.file(worktreePath), { location: 'newWindow' });
}
