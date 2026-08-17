export type RebaseTodoAction = 'squash' | 'fixup' | 'drop' | 'reword';

/**
 * Rewrites an interactive-rebase todo to apply a rewrite action to a set of selected commits.
 *
 * - `squash`/`fixup`: the todo is oldest-first, so the FIRST selected commit encountered stays `pick`
 *   (it's the target the rest fold into) and every subsequent selected commit becomes `squash`/`fixup`.
 * - `drop`/`reword`: every selected commit becomes `drop`/`reword` (no `pick` target is kept).
 *
 * Non-selected commits and non-`pick` lines (comments, `update-ref`, blanks) are left untouched.
 * `selectedShas` are full SHAs; todo lines carry abbreviated SHAs, so matching is prefix-based.
 *
 * Git abbreviates the `pick` command to `p` when `rebase.abbreviateCommands` is enabled, so both forms
 * are matched. The rewritten line uses the full action word, which git accepts regardless of that setting.
 *
 * Pure and free of `vscode`/Node imports so the bundled `rebaseTodoEditor.ts` entry — git's
 * `sequence.editor` for headless squash/drop/reword — can import it directly, and so it can be
 * unit tested.
 */
export function applyRebaseActionToTodo(
	todo: string,
	selectedShas: readonly string[],
	action: RebaseTodoAction,
): string {
	// Only squash/fixup fold commits into an earlier target, so they keep the oldest selected as `pick`.
	const keepsFirst = action === 'squash' || action === 'fixup';
	let seenFirst = false;
	return todo
		.split('\n')
		.map(line => {
			const match = /^(?:pick|p)\s+([0-9a-f]+)\b/.exec(line);
			if (match == null) return line;
			if (!selectedShas.some(sha => sha.startsWith(match[1]))) return line;
			if (keepsFirst && !seenFirst) {
				seenFirst = true;
				return line;
			}
			return line.replace(/^(?:pick|p)(\s)/, `${action}$1`);
		})
		.join('\n');
}

/**
 * Rewrites an interactive-rebase todo to relocate a `fixup!` commit directly under its target: the
 * fixup's todo line is removed and re-inserted immediately after the target's line, with its action
 * changed to `fixup`. Used for the Commit Graph's "Commit Fixup & Squash" headless rebase, which
 * commits a `fixup!`-prefixed message and immediately folds it into its target rather than waiting
 * for a later `--autosquash` pass.
 *
 * If either the fixup or the target line isn't found in the todo (e.g. the target isn't in the
 * rebase range), the todo is returned unchanged — the rebase then just replays normally, a safe no-op.
 *
 * `fixupSha`/`targetSha` are full SHAs; todo lines carry abbreviated SHAs, so matching is prefix-based
 * (same convention as {@link applyRebaseActionToTodo}).
 */
export function moveFixupInTodo(todo: string, fixupSha: string, targetSha: string): string {
	const lines = todo.split('\n');

	const findLineIndex = (sha: string) =>
		lines.findIndex(line => {
			const match = /^(?:pick|p)\s+([0-9a-f]+)\b/.exec(line);
			return match != null && sha.startsWith(match[1]);
		});

	const fixupIndex = findLineIndex(fixupSha);
	if (fixupIndex === -1) return todo;

	const targetIndex = findLineIndex(targetSha);
	if (targetIndex === -1) return todo;

	const [fixupLine] = lines.splice(fixupIndex, 1);
	// Removing the fixup line shifts the target's index down by one if the fixup was above it.
	const adjustedTargetIndex = fixupIndex < targetIndex ? targetIndex - 1 : targetIndex;
	lines.splice(adjustedTargetIndex + 1, 0, fixupLine.replace(/^(?:pick|p)(\s)/, 'fixup$1'));

	return lines.join('\n');
}
