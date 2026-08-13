import type { RepositoryChange } from '../models/repository.js';

const classifyRegex =
	/(worktrees|index|HEAD|FETCH_HEAD|ORIG_HEAD|CHERRY_PICK_HEAD|MERGE_HEAD|REBASE_HEAD|rebase-merge|rebase-apply|sequencer|REVERT_HEAD|config|gk\/config|info\/exclude|refs\/(?:heads|remotes|stash|tags)|packed-refs)/;

/**
 * Maps a path relative to a `.git` directory to the corresponding
 * {@link RepositoryChange} types. This is pure Git knowledge — the
 * regex and switch table encode which files in `.git/` correspond
 * to which logical repository changes.
 *
 * @param relativePath - Path relative to the `.git` directory
 *   (e.g., `refs/heads/main`, `HEAD`, `config`)
 * @returns An array of change types, or `undefined` if the path
 *   is noise or unrecognized. `undefined` for `FETCH_HEAD` which
 *   is intentionally not mapped to a change type (the extension
 *   handles it as a last-fetched timestamp).
 */
export function classifyGitDirChange(relativePath: string): RepositoryChange[] | undefined {
	// User-edited todo file (and its backup) — handled by VS Code's TextDocument
	// events in the rebase webview (see `rebaseWebviewProvider.ts`). Suppress here
	// to avoid thrashing the repo update path on every save during an interactive
	// rebase; rebase lifecycle (start/stop/step) still fires from sibling files
	// in `rebase-merge/` and the directory itself.
	if (relativePath.endsWith('/git-rebase-todo') || relativePath.endsWith('/git-rebase-todo.backup')) {
		return undefined;
	}

	const match = classifyRegex.exec(relativePath);
	if (match == null) return undefined;

	switch (match[1]) {
		case 'config':
			return ['config', 'remotes'];

		case 'gk/config':
			return ['gkConfig'];

		case 'info/exclude':
			return ['ignores'];

		case 'index':
			return ['index'];

		case 'FETCH_HEAD':
			// No RepositoryChange — extension handles this for last-fetched timestamps
			return undefined;

		case 'HEAD':
			return ['head', 'heads'];

		case 'ORIG_HEAD':
			return ['heads'];

		case 'CHERRY_PICK_HEAD':
			return ['cherryPick', 'pausedOp'];

		case 'MERGE_HEAD':
			return ['merge', 'pausedOp'];

		case 'REBASE_HEAD':
		case 'rebase-merge':
		case 'rebase-apply':
			return ['rebase', 'pausedOp'];

		case 'REVERT_HEAD':
			return ['revert', 'pausedOp'];

		case 'sequencer':
			return ['pausedOp'];

		// `'heads'` is deliberately the ONLY thing a `refs/heads/*` event yields, including a create. It is
		// tempting to read a create as "a new branch exists under this name" and use it to drop anything
		// derived from the old branch's identity (its base, its merge target). That signal does not mean
		// what it looks like: git rewrites an EXISTING loose ref by writing `<name>.lock` and renaming it
		// over the file, which watchers report as a create of the destination — so every ordinary commit
		// would look like a new branch and discard a live branch's metadata. Nothing here can distinguish
		// the two; identity changes are handled where GitLens performs the operation itself.
		case 'refs/heads':
			return ['heads'];

		case 'refs/remotes':
			return ['remotes'];

		case 'refs/stash':
			return ['stash'];

		case 'refs/tags':
			return ['tags'];

		// A `packed-refs` rewrite (after `git pack-refs` or `git gc`) changes ref state
		// WITHOUT any `refs/**` file event — deleting a packed branch, for example, only
		// rewrites this file. The file content is not inspected here, so classification
		// is deliberately broad: it can add, remove, or move refs of any of these types.
		case 'packed-refs':
			return ['heads', 'remotes', 'tags'];

		case 'worktrees':
			return ['worktrees'];

		default:
			return undefined;
	}
}
