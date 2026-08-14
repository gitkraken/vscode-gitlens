import { commands, extensions, TabInputWebview, window } from 'vscode';

export const claudeExtensionId = 'Anthropic.claude-code';
export const claudeExtensionOpenCommand = 'claude-vscode.editor.open';
/** Opens the session in the active editor column. Accepts `(sessionId, prompt)`; used as the
 *  middle rung of {@link tryOpenClaudeSession} when `claude-vscode.editor.open` isn't available
 *  (e.g. older Claude Code versions). */
export const claudeExtensionPrimaryEditorOpenCommand = 'claude-vscode.primaryEditor.open';
/** Focuses the Claude Code sidebar webview. Accepts no arguments — it cannot target a specific
 *  session — so it's only the last-resort rung of {@link tryOpenClaudeSession}. */
export const claudeExtensionSidebarOpenCommand = 'claude-vscode.sidebar.open';
/** The webview-panel viewType the Claude Code extension uses for its conversation editor tabs
 *  (`window.createWebviewPanel('claudeVSCodePanel', ...)`). Lets us detect a Claude tab via the
 *  active tab's `TabInputWebview.viewType`, and gates our `editor/title` button via the
 *  `activeWebviewPanelId == claudeVSCodePanel` when-clause. */
export const claudeExtensionPanelViewType = 'claudeVSCodePanel';

/** Whether the window's active tab is a Claude Code conversation panel. The Tabs API surfaces
 *  `createWebviewPanel` viewTypes with a `mainThreadWebview-` prefix, so both the raw id and the
 *  prefixed form are accepted. The one shared detection point — tab-following and the tab
 *  worktree commands must never drift on this heuristic. */
export function isActiveClaudeTab(): boolean {
	const input = window.tabGroups.activeTabGroup?.activeTab?.input;
	if (!(input instanceof TabInputWebview)) return false;

	return (
		input.viewType === claudeExtensionPanelViewType || input.viewType.endsWith(`-${claudeExtensionPanelViewType}`)
	);
}

/** Returns `true` when the Claude Code VS Code extension is installed AND at least one of its
 *  sessionId-bearing open commands is registered (`editor.open` or `primaryEditor.open` — older
 *  Claude Code versions registered only the latter). Deliberately excludes `sidebar.open`: it
 *  takes no arguments and can't carry a sessionId or prompt, so it's not usable as a primary
 *  dispatch target. The picker uses this to gate the "Claude" entry; the agent status service
 *  uses it as the fallback decision when the session metadata file doesn't tell us whether the
 *  session is extension-hosted or CLI-hosted. */
export async function isClaudeExtensionAvailable(): Promise<boolean> {
	if (extensions.getExtension(claudeExtensionId) == null) return false;

	const registered = await commands.getCommands(true);
	return (
		registered.includes(claudeExtensionOpenCommand) || registered.includes(claudeExtensionPrimaryEditorOpenCommand)
	);
}

/** Shared fallback chain for opening a Claude Code session via the Claude Code VS Code extension:
 *  1. `claude-vscode.editor.open(sessionId)` — new tab, the preferred experience.
 *  2. `claude-vscode.primaryEditor.open(sessionId)` — active column, used when (1) isn't registered.
 *  3. `claude-vscode.sidebar.open()` — last-resort sidebar focus; cannot target a session so the
 *     user lands on whatever session the sidebar last had focused.
 *
 *  Returns `true` once any rung succeeds, `false` when all three throw. Used in two places that
 *  both need the same chain — keeping the logic here avoids drift between the local-window path
 *  and the peer-window IPC callback. */
export async function tryOpenClaudeSession(sessionId: string): Promise<boolean> {
	try {
		await commands.executeCommand(claudeExtensionOpenCommand, sessionId);
		return true;
	} catch {
		// fall through
	}
	try {
		await commands.executeCommand(claudeExtensionPrimaryEditorOpenCommand, sessionId);
		return true;
	} catch {
		// fall through
	}
	try {
		await commands.executeCommand(claudeExtensionSidebarOpenCommand);
		return true;
	} catch {
		return false;
	}
}
