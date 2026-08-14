import type { Container } from '../../../container.js';

/**
 * Returns git's `GIT_EDITOR` command for automatic-rebase continues, plus the environment it needs.
 *
 * The command is a pure-sh script shipped in `dist/` (`rebaseMessageEditor.sh`; git runs editors
 * through its bundled sh on every platform, including Windows) that auto-accepts git's prepared
 * commit message except at `reword`/`squash` steps, where it opens the message in the host VS Code
 * window (`GL_MESSAGE_EDITOR`) and blocks until the tab closes — so an automated run never silently
 * discards a message the user asked to edit.
 */
export async function getAutoRebaseMessageEditor(
	container: Container,
): Promise<{ editor: string; env: Record<string, string> } | undefined> {
	// Lazily import on demand — `-webview/vscode.js` drags in the command/container module graph,
	// which must not be pulled into this module's importers (e.g. the auto-rebase service) at
	// module-init time
	const { getHostEditorCommand } = await import('../../../system/-webview/vscode.js');

	const script = container.context.asAbsolutePath('dist/rebaseMessageEditor.sh');
	return {
		// Run through `sh` explicitly so the script doesn't depend on the executable bit surviving
		// packaging (webpack's copy doesn't preserve file mode)
		editor: `sh "${script.replace(/\\/g, '/')}"`,
		env: { GL_MESSAGE_EDITOR: await getHostEditorCommand(true) },
	};
}
