import { execPath, platform } from 'node:process';
import type { Container } from '../../../container.js';

/**
 * Returns git's `sequence.editor` command for the Commit Graph's headless squash/drop/reword, plus
 * the environment it needs.
 *
 * The command is a platform wrapper script shipped in `dist/` (`rebaseTodoEditor.sh`/`.cmd`) that
 * launches the bundled `dist/rebaseTodoEditor.js` as Node. The wrapper sets `ELECTRON_RUN_AS_NODE=1`
 * internally so it stays scoped to that subprocess and can't interfere with the real VS Code instance
 * used as `core.editor` for the combined-message edit. The Electron and script paths are passed via
 * the environment (`GL_REBASE_EDITOR_NODE`/`GL_REBASE_EDITOR_SCRIPT`) so nothing is hardcoded.
 */
export function getSquashSequenceEditor(container: Container): { editor: string; env: Record<string, string> } {
	const wrapper = container.context.asAbsolutePath(`dist/rebaseTodoEditor.${platform === 'win32' ? 'cmd' : 'sh'}`);
	const script = container.context.asAbsolutePath('dist/rebaseTodoEditor.js');

	// On Unix run the wrapper through `sh` so it doesn't depend on the executable bit surviving
	// packaging (webpack's copy doesn't preserve file mode); on Windows point at the `.cmd` directly.
	return {
		editor: platform === 'win32' ? `"${wrapper}"` : `sh "${wrapper}"`,
		env: { GL_REBASE_EDITOR_NODE: execPath, GL_REBASE_EDITOR_SCRIPT: script },
	};
}
