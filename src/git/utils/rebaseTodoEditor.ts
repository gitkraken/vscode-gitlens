import { readFileSync, writeFileSync } from 'node:fs';
import { argv, env, exit } from 'node:process';
import type { RebaseTodoAction } from './rebaseTodo.js';
import { applyRebaseActionToTodo, moveFixupInTodo } from './rebaseTodo.js';

/**
 * Standalone Node script used as git's `sequence.editor` for the Commit Graph's headless rebases.
 * Bundled to `dist/rebaseTodoEditor.js` and launched as Node by the platform wrapper scripts
 * (`rebaseTodoEditor.sh`/`.cmd`), it rewrites the `git-rebase-todo` git hands it (argv[2]) in place,
 * choosing one of three modes based on the environment:
 *
 * 1. `GL_ACCEPT_TODO` — a true `--autosquash` rebase where git has already rewritten the todo
 *    correctly; the script is a no-op "editor" that just accepts the file as-is.
 * 2. `GL_FIXUP_SHA`/`GL_FIXUP_TARGET` — relocates a single `fixup!` commit directly under its target
 *    via {@link moveFixupInTodo}.
 * 3. `GL_SQUASH_SHAS`/`GL_SQUASH_ACTION` — the existing headless squash/drop/reword, applying the
 *    action to the selected commits via {@link applyRebaseActionToTodo}.
 *
 * Imports the shared {@link applyRebaseActionToTodo}/{@link moveFixupInTodo} so the transforms have a
 * single source of truth. Must not import `vscode` (it runs in a plain Node subprocess, not the
 * extension host).
 */
const file = argv[2];
if (file == null) {
	exit(1);
}

try {
	if (env.GL_ACCEPT_TODO) {
		exit(0);
	}

	if (env.GL_FIXUP_SHA && env.GL_FIXUP_TARGET) {
		writeFileSync(file, moveFixupInTodo(readFileSync(file, 'utf8'), env.GL_FIXUP_SHA, env.GL_FIXUP_TARGET));
		exit(0);
	}

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
