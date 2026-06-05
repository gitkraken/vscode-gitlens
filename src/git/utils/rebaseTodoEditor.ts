import { readFileSync, writeFileSync } from 'node:fs';
import { argv, env, exit } from 'node:process';
import type { RebaseTodoAction } from './rebaseTodo.js';
import { applyRebaseActionToTodo } from './rebaseTodo.js';

/**
 * Standalone Node script used as git's `sequence.editor` for the Commit Graph's headless
 * squash/drop/reword. Bundled to `dist/rebaseTodoEditor.js` and launched as Node by the platform
 * wrapper scripts (`rebaseTodoEditor.sh`/`.cmd`), it rewrites the `git-rebase-todo` git hands it
 * (argv[2]) in place, applying the action from the environment to the selected commits.
 *
 * Imports the shared {@link applyRebaseActionToTodo} so the transform has a single source of truth.
 * Must not import `vscode` (it runs in a plain Node subprocess, not the extension host).
 */
const file = argv[2];
if (file == null) {
	exit(1);
}

try {
	const shas = (env.GL_SQUASH_SHAS ?? '').split(',').filter(Boolean);
	const requested = env.GL_SQUASH_ACTION;
	const action: RebaseTodoAction =
		requested === 'fixup' || requested === 'drop' || requested === 'reword' ? requested : 'squash';
	if (shas.length === 0) {
		exit(1);
	}

	writeFileSync(file, applyRebaseActionToTodo(readFileSync(file, 'utf8'), shas, action));
	exit(0);
} catch {
	exit(1);
}
