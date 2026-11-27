import type { GitReflogEntry } from '../models/reflog.js';
import type { WatcherRepoChangeEvent } from './changeEvent.js';

// SEE: `git reflog` (git 2.56.1) logs `git commit` as `commit`, `commit (amend|initial|merge|cherry-pick)`
const commitReflogRegex = /^commit(?: \((?:amend|initial)\))?: /;

export function isCommitCreated(
	previousSha: string | undefined,
	current: GitReflogEntry | undefined,
	e: WatcherRepoChangeEvent,
): boolean {
	if (previousSha == null || current == null || current.sha === previousSha) {
		return false;
	}

	if (e.changed('rebase', 'merge', 'cherryPick', 'revert', 'pausedOp')) {
		return false;
	}

	return commitReflogRegex.test(current.message);
}
