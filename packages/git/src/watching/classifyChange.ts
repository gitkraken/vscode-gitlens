import type { RepositoryChange } from '../models/repository.js';

const classifyRegex =
	/(worktrees|index|HEAD|FETCH_HEAD|ORIG_HEAD|CHERRY_PICK_HEAD|MERGE_HEAD|REBASE_HEAD|rebase-merge|rebase-apply|sequencer|REVERT_HEAD|config|gk\/config|info\/exclude|refs\/(?:heads|remotes|stash|tags))/;

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

		case 'refs/heads':
			return ['heads'];

		case 'refs/remotes':
			return ['remotes'];

		case 'refs/stash':
			return ['stash'];

		case 'refs/tags':
			return ['tags'];

		case 'worktrees':
			return ['worktrees'];

		default:
			return undefined;
	}
}
