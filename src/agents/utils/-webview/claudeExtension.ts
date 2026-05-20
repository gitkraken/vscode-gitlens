import { commands, extensions } from 'vscode';

export const claudeExtensionId = 'Anthropic.claude-code';
export const claudeExtensionOpenCommand = 'claude-vscode.editor.open';

/** Returns `true` when the Claude Code VS Code extension is installed AND its session-open
 *  command is registered (i.e. the extension has activated far enough that the command will
 *  resolve). The picker uses this to gate the "Claude" entry; the agent status service uses
 *  it as the fallback decision when the session metadata file doesn't tell us whether the
 *  session is extension-hosted or CLI-hosted. */
export async function isClaudeExtensionAvailable(): Promise<boolean> {
	if (extensions.getExtension(claudeExtensionId) == null) return false;

	const registered = await commands.getCommands(true);
	return registered.includes(claudeExtensionOpenCommand);
}
