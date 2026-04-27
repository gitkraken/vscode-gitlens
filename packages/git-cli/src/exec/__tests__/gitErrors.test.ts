import * as assert from 'assert';
import { RunError } from '../exec.errors.js';
import {
	classifySigningError,
	getGitCommandError,
	GitError,
	GitErrors,
	GitWarnings,
	inferSigningFormatFromError,
} from '../git.js';

/**
 * Helper: creates a GitError wrapping a RunError with the given stderr.
 * This simulates what happens when a real git process exits non-zero.
 */
function makeGitError(stderr: string, stdout = ''): GitError {
	const runError = new RunError({ message: stderr, cmd: 'git', code: 128 }, stdout, stderr);
	return new GitError(runError);
}

suite('GitErrors Regex Test Suite', () => {
	suite('push errors', () => {
		test('pushRejected matches "failed to push some refs"', () => {
			const stderr = "error: failed to push some refs to 'https://github.com/user/repo.git'";
			assert.ok(GitErrors.pushRejected.test(stderr));
		});

		test('noUpstream matches "has no upstream branch"', () => {
			const stderr =
				'fatal: The current branch feature/test has no upstream branch.\nTo push the current branch and set the remote as upstream, use\n\n    git push --set-upstream origin feature/test';
			assert.ok(GitErrors.noUpstream.test(stderr));
		});

		test('permissionDenied matches "Permission denied (publickey)"', () => {
			const stderr = 'Permission denied (publickey).';
			assert.ok(GitErrors.permissionDenied.test(stderr));
		});

		test('remoteAhead matches "rejected because the remote contains work"', () => {
			const stderr =
				'To github.com:user/repo.git\n ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs\nhint: Updates were rejected because the remote contains work that you do not have locally.';
			assert.ok(GitErrors.remoteAhead.test(stderr));
		});

		test('remoteConnectionFailed matches "Could not read from remote repository"', () => {
			const stderr =
				"fatal: 'origin' does not appear to be a git repository\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.";
			assert.ok(GitErrors.remoteConnectionFailed.test(stderr));
		});

		test('noFastForward matches "(non-fast-forward)"', () => {
			const stderr = '! [rejected]        main -> main (non-fast-forward)';
			assert.ok(GitErrors.noFastForward.test(stderr));
		});

		test('pushRejected does not match normal output mentioning "push"', () => {
			const stdout = 'Everything up-to-date';
			assert.ok(!GitErrors.pushRejected.test(stdout));
		});

		test('noUpstream does not match upstream info message', () => {
			const msg = "Your branch is up to date with 'origin/main'.";
			assert.ok(!GitErrors.noUpstream.test(msg));
		});
	});

	suite('checkout errors', () => {
		test('changesWouldBeOverwritten matches "local changes would be overwritten"', () => {
			const stderr =
				'error: Your local changes to the following files would be overwritten by checkout:\n\tsrc/index.ts\nPlease commit your changes or stash them before you switch branches.';
			assert.ok(GitErrors.changesWouldBeOverwritten.test(stderr));
		});

		test('changesWouldBeOverwritten matches "overwritten by checkout"', () => {
			const stderr =
				'error: The following untracked working tree files would be overwritten by checkout:\n\tnewfile.ts';
			assert.ok(GitErrors.changesWouldBeOverwritten.test(stderr));
		});

		test('alreadyCheckedOut matches "already checked out"', () => {
			const stderr = "fatal: 'feature/branch' is already checked out at '/path/to/worktree'";
			assert.ok(GitErrors.alreadyCheckedOut.test(stderr));
		});

		test('changesWouldBeOverwritten does not match clean checkout', () => {
			const stdout = "Switched to branch 'main'";
			assert.ok(!GitErrors.changesWouldBeOverwritten.test(stdout));
		});
	});

	suite('branch errors', () => {
		test('branchAlreadyExists matches "A branch named already exists"', () => {
			const stderr = "fatal: A branch named 'feature/test' already exists.";
			assert.ok(GitErrors.branchAlreadyExists.test(stderr));
		});

		test('notFullyMerged matches "not fully merged"', () => {
			const stderr =
				"error: The branch 'feature/old' is not fully merged.\nIf you are sure you want to delete it, run 'git branch -D feature/old'.";
			assert.ok(GitErrors.notFullyMerged.test(stderr));
		});

		test('invalidName matches "not a valid branch name"', () => {
			const stderr = "fatal: '..invalid' is not a valid branch name.";
			assert.ok(GitErrors.invalidName.test(stderr));
		});

		test('noRemoteReference matches "remote ref does not exist"', () => {
			const stderr = "error: unable to delete 'feature/gone': remote ref does not exist";
			assert.ok(GitErrors.noRemoteReference.test(stderr));
		});

		test('branchAlreadyExists does not match "already exists" in non-branch context', () => {
			const stderr = "fatal: A tag named 'v1.0' already exists.";
			assert.ok(!GitErrors.branchAlreadyExists.test(stderr));
		});
	});

	suite('merge/rebase errors', () => {
		test('conflict matches "CONFLICT (content):"', () => {
			const stderr = 'CONFLICT (content): Merge conflict in src/index.ts';
			assert.ok(GitErrors.conflict.test(stderr));
		});

		test('mergeInProgress matches "You have not concluded your merge"', () => {
			const stderr =
				'fatal: You have not concluded your merge (MERGE_HEAD exists).\nPlease, commit your changes before you merge.';
			assert.ok(GitErrors.mergeInProgress.test(stderr));
		});

		test('mergeAborted matches "merge aborted"', () => {
			const stderr = 'merge aborted';
			assert.ok(GitErrors.mergeAborted.test(stderr));
		});

		test('unresolvedConflicts matches "Resolve all conflicts"', () => {
			const stderr = 'error: Resolve all conflicts manually, mark them as resolved with\n"git add"';
			assert.ok(GitErrors.unresolvedConflicts.test(stderr));
		});

		test('unresolvedConflicts matches "You must edit all merge conflicts"', () => {
			const stderr = 'You must edit all merge conflicts and then\nmark them as resolved using git add';
			assert.ok(GitErrors.unresolvedConflicts.test(stderr));
		});

		test('rebaseInProgress matches "rebase-merge directory"', () => {
			const stderr =
				'It seems that there is already a rebase-merge directory, and\nI wonder if you are in the middle of another rebase.';
			assert.ok(GitErrors.rebaseInProgress.test(stderr));
		});

		test('rebaseInProgress matches "rebase-apply directory"', () => {
			const stderr =
				'It seems that there is already a rebase-apply directory, and\nI wonder if you are in the middle of another rebase.';
			assert.ok(GitErrors.rebaseInProgress.test(stderr));
		});

		test('rebaseMultipleBranches matches "cannot rebase onto multiple branches"', () => {
			const stderr = 'fatal: cannot rebase onto multiple branches';
			assert.ok(GitErrors.rebaseMultipleBranches.test(stderr));
		});

		test('conflict does not match the word "conflict" in a message', () => {
			const msg = 'There was a conflict resolving the merge.';
			assert.ok(!GitErrors.conflict.test(msg));
		});
	});

	suite('stash errors', () => {
		test('stashNothingToSave matches "No local changes to save"', () => {
			const stderr = 'No local changes to save';
			assert.ok(GitErrors.stashNothingToSave.test(stderr));
		});

		test('stashConflictingStagedAndUnstagedLines matches "Cannot remove worktree changes"', () => {
			const stderr = 'error: Cannot remove worktree changes';
			assert.ok(GitErrors.stashConflictingStagedAndUnstagedLines.test(stderr));
		});

		test('stashSavedWorkingDirAndIndexState matches expected output', () => {
			const stdout = 'Saved working directory and index state WIP on main: abc1234 last commit';
			assert.ok(GitErrors.stashSavedWorkingDirAndIndexState.test(stdout));
		});

		test('stashNothingToSave does not match "local changes would be overwritten"', () => {
			const msg = 'Your local changes would be overwritten';
			assert.ok(!GitErrors.stashNothingToSave.test(msg));
		});
	});

	suite('tag errors', () => {
		test('tagAlreadyExists matches "tag already exists"', () => {
			const stderr = "fatal: tag 'v1.0.0' already exists";
			assert.ok(GitErrors.tagAlreadyExists.test(stderr));
		});

		test('invalidTagName matches "invalid tag name"', () => {
			const stderr = "fatal: invalid tag name '..bad'";
			assert.ok(GitErrors.invalidTagName.test(stderr));
		});

		test('tagNotFound matches "tag not found"', () => {
			const stderr = "error: tag 'v99.0.0' not found.";
			assert.ok(GitErrors.tagNotFound.test(stderr));
		});

		test('tagConflict matches "would clobber existing tag"', () => {
			const stderr = ' ! [rejected]        v1.0 -> v1.0 (would clobber existing tag)';
			assert.ok(GitErrors.tagConflict.test(stderr));
		});
	});

	suite('worktree errors', () => {
		test('mainWorkingTree matches "is a main working tree"', () => {
			const stderr = "fatal: '/path/to/repo' is a main working tree";
			assert.ok(GitErrors.mainWorkingTree.test(stderr));
		});

		test('uncommittedChanges matches "contains modified or untracked files"', () => {
			const stderr = "error: '/path/to/worktree' contains modified or untracked files, use --force to delete it";
			assert.ok(GitErrors.uncommittedChanges.test(stderr));
		});

		test('alreadyExists matches "already exists"', () => {
			const stderr = "fatal: '/path/to/worktree' already exists";
			assert.ok(GitErrors.alreadyExists.test(stderr));
		});
	});

	suite('general errors', () => {
		test('ambiguousArgument matches real git output', () => {
			const stderr = "fatal: ambiguous argument 'nonexistent': unknown revision or path not in the working tree.";
			assert.ok(GitErrors.ambiguousArgument.test(stderr));
		});

		test('noUserNameConfigured matches "Please tell me who you are"', () => {
			const stderr =
				'*** Please tell me who you are.\n\nRun\n\n  git config --global user.email "you@example.com"';
			assert.ok(GitErrors.noUserNameConfigured.test(stderr));
		});

		test('commitChangesFirst matches "Please, commit your changes"', () => {
			const stderr = 'error: Please, commit your changes before you can merge.';
			assert.ok(GitErrors.commitChangesFirst.test(stderr));
		});

		test('unsafeRepository matches dubious ownership warning', () => {
			const stderr =
				"fatal: detected dubious ownership in repository at '/home/user/repo'\nTo add an exception for this directory, call:\n\n\tgit config --global --add safe.directory /home/user/repo";
			assert.ok(GitErrors.unsafeRepository.test(stderr));
		});

		test('cantLockRef matches "cannot lock ref"', () => {
			const stderr = "fatal: cannot lock ref 'refs/heads/main': unable to create file";
			assert.ok(GitErrors.cantLockRef.test(stderr));
		});

		test('cantLockRef matches "unable to update local ref"', () => {
			const stderr = "error: unable to update local ref 'refs/remotes/origin/main'";
			assert.ok(GitErrors.cantLockRef.test(stderr));
		});
	});

	suite('cherry-pick/revert errors', () => {
		test('cherryPickInProgress matches "cherry-pick is already in progress"', () => {
			const stderr = "error: cherry-pick is already in progress\nhint: try 'git cherry-pick --continue'";
			assert.ok(GitErrors.cherryPickInProgress.test(stderr));
		});

		test('cherryPickEmptyPrevious matches "The previous cherry-pick is now empty"', () => {
			const stderr = 'The previous cherry-pick is now empty, possibly due to conflict resolution.';
			assert.ok(GitErrors.cherryPickEmptyPrevious.test(stderr));
		});

		test('revertInProgress matches "revert is already in progress"', () => {
			const stderr = "error: revert is already in progress\nhint: try 'git revert --continue'";
			assert.ok(GitErrors.revertInProgress.test(stderr));
		});

		test('revertInProgress matches "cherry-pick is already in progress" (shared regex)', () => {
			const stderr = 'cherry-pick is already in progress';
			assert.ok(GitErrors.revertInProgress.test(stderr));
		});
	});
});

suite('GitWarnings Regex Test Suite', () => {
	test('notARepository matches "Not a git repository"', () => {
		const stderr = 'fatal: not a git repository (or any of the parent directories): .git';
		assert.ok(GitWarnings.notARepository.test(stderr));
	});

	test('noUpstream matches "no upstream configured for branch"', () => {
		const stderr = "error: no upstream configured for branch 'feature/test'";
		assert.ok(GitWarnings.noUpstream.test(stderr));
	});

	test('notFound matches "does not exist in"', () => {
		const stderr = "fatal: Path 'src/missing.ts' does not exist in 'abc1234'";
		assert.ok(GitWarnings.notFound.test(stderr));
	});

	test('foundButNotInRevision matches "exists on disk, but not in"', () => {
		const stderr = "fatal: Path 'src/new.ts' exists on disk, but not in 'abc1234'";
		assert.ok(GitWarnings.foundButNotInRevision.test(stderr));
	});

	test('tipBehind matches "tip of your current branch is behind"', () => {
		const stderr =
			'hint: Updates were rejected because the tip of your current branch is behind\nhint: its remote counterpart.';
		assert.ok(GitWarnings.tipBehind.test(stderr));
	});

	test('notAGitCommand matches "is not a git command"', () => {
		const stderr = "git: 'blah' is not a git command. See 'git --help'.";
		assert.ok(GitWarnings.notAGitCommand.test(stderr));
	});

	test('notARepository does not match clean repository output', () => {
		const stdout = 'On branch main\nnothing to commit, working tree clean';
		assert.ok(!GitWarnings.notARepository.test(stdout));
	});
});

suite('getGitCommandError() Test Suite', () => {
	/**
	 * Calls getGitCommandError with a lightweight reason-capturing creator.
	 * Uses `as any` casts to bypass the GitCommandError constraint since we only
	 * care about verifying which reason string the mapping produces.
	 */
	function captureReason(command: string, ex: GitError): string | undefined {
		let captured: string | undefined;
		(getGitCommandError as any)(command, ex, (reason: string | undefined) => {
			captured = reason;
			return { reason: reason };
		});
		return captured;
	}

	test('maps push stderr to "rejected" reason', () => {
		const ex = makeGitError("error: failed to push some refs to 'origin'");
		assert.strictEqual(captureReason('push', ex), 'rejected');
	});

	test('maps push stderr to "noUpstream" reason', () => {
		const ex = makeGitError('fatal: The current branch feature has no upstream branch.');
		assert.strictEqual(captureReason('push', ex), 'noUpstream');
	});

	test('maps push stderr to "permissionDenied" reason', () => {
		const ex = makeGitError('Permission denied (publickey).');
		assert.strictEqual(captureReason('push', ex), 'permissionDenied');
	});

	test('maps push stderr to "remoteAhead" reason', () => {
		const ex = makeGitError('rejected because the remote contains work that you do not have locally');
		assert.strictEqual(captureReason('push', ex), 'remoteAhead');
	});

	test('maps push stderr to "tipBehind" reason', () => {
		const ex = makeGitError('Updates were rejected because the tip of your current branch is behind');
		assert.strictEqual(captureReason('push', ex), 'tipBehind');
	});

	test('returns undefined reason for unrecognized push error', () => {
		const ex = makeGitError('some unknown error happened');
		assert.strictEqual(captureReason('push', ex), undefined);
	});

	test('maps checkout stderr to "wouldOverwriteChanges" reason', () => {
		const ex = makeGitError(
			'Your local changes to the following files would be overwritten by checkout:\n\tfile.ts',
		);
		assert.strictEqual(captureReason('checkout', ex), 'wouldOverwriteChanges');
	});

	test('maps branch stderr to "alreadyExists" reason', () => {
		const ex = makeGitError("fatal: A branch named 'main' already exists.");
		assert.strictEqual(captureReason('branch', ex), 'alreadyExists');
	});

	test('maps branch stderr to "notFullyMerged" reason', () => {
		const ex = makeGitError("error: The branch 'feature' is not fully merged.");
		assert.strictEqual(captureReason('branch', ex), 'notFullyMerged');
	});

	test('maps merge stderr to "conflicts" reason', () => {
		const ex = makeGitError('Resolve all conflicts manually');
		assert.strictEqual(captureReason('merge', ex), 'conflicts');
	});

	test('maps stash-push stderr to "nothingToSave" reason', () => {
		const ex = makeGitError('No local changes to save');
		assert.strictEqual(captureReason('stash-push', ex), 'nothingToSave');
	});

	test('maps pull stderr to "conflict" reason', () => {
		const ex = makeGitError('CONFLICT (content): Merge conflict in file.ts');
		assert.strictEqual(captureReason('pull', ex), 'conflict');
	});

	test('maps pull stderr to "refLocked" reason', () => {
		const ex = makeGitError("fatal: cannot lock ref 'refs/heads/main': unable to create file");
		assert.strictEqual(captureReason('pull', ex), 'refLocked');
	});

	test('maps rebase stderr to "alreadyInProgress" reason', () => {
		const ex = makeGitError('It seems that there is already a rebase-merge directory');
		assert.strictEqual(captureReason('rebase', ex), 'alreadyInProgress');
	});

	test('maps tag stderr to "alreadyExists" reason', () => {
		const ex = makeGitError("fatal: tag 'v1.0' already exists");
		assert.strictEqual(captureReason('tag', ex), 'alreadyExists');
	});

	test('maps worktree-create stderr to "alreadyCheckedOut" reason', () => {
		const ex = makeGitError("fatal: 'main' is already checked out at '/path'");
		assert.strictEqual(captureReason('worktree-create', ex), 'alreadyCheckedOut');
	});

	test('maps worktree-delete stderr to "defaultWorkingTree" reason', () => {
		const ex = makeGitError("fatal: '/repo' is a main working tree");
		assert.strictEqual(captureReason('worktree-delete', ex), 'defaultWorkingTree');
	});

	test('matches on stderr property when toString does not match', () => {
		// Create a GitError where the message is generic but stderr has the real error
		const runError = new RunError(
			{ message: 'Command failed', cmd: 'git push', code: 1 },
			'',
			'fatal: The current branch test has no upstream branch.',
		);
		const ex = new GitError(runError);
		assert.strictEqual(captureReason('push', ex), 'noUpstream');
	});

	test('maps show stderr to "invalidRevision" for bad revision', () => {
		const ex = makeGitError("fatal: bad revision 'nonexistent'");
		assert.strictEqual(captureReason('show', ex), 'invalidRevision');
	});

	test('maps fetch stderr to "remoteConnectionFailed" reason', () => {
		const ex = makeGitError('fatal: Could not read from remote repository.');
		assert.strictEqual(captureReason('fetch', ex), 'remoteConnectionFailed');
	});
});

suite('Signing Errors Test Suite', () => {
	suite('GitErrors signing regexes', () => {
		test('gpgSignFailed matches standard gpg sign failure', () => {
			const stderr = 'error: gpg failed to sign the data\nfatal: failed to write commit object';
			assert.ok(GitErrors.gpgSignFailed.test(stderr));
		});

		test('gpgSignFailed matches with CRLF line endings', () => {
			const stderr = 'error: gpg failed to sign the data\r\nfatal: failed to write commit object\r\n';
			assert.ok(GitErrors.gpgSignFailed.test(stderr));
		});

		test('gpgSignFailed does NOT match unrelated gpg config error', () => {
			// Intentional narrowing vs. the old patch.ts substring check which matched
			// any "error: gpg" prefix and falsely classified config errors as passphrase failures.
			const stderr = 'error: gpg.format is set to an invalid value';
			assert.ok(!GitErrors.gpgSignFailed.test(stderr));
		});

		test('signingKeyNotAvailable matches "No secret key"', () => {
			const stderr = 'gpg: skipped "ABC123": No secret key';
			assert.ok(GitErrors.signingKeyNotAvailable.test(stderr));
		});

		test('signingKeyNotAvailable matches "signing failed: No secret key"', () => {
			const stderr = 'gpg: signing failed: No secret key';
			assert.ok(GitErrors.signingKeyNotAvailable.test(stderr));
		});

		test('signingKeyNotAvailable matches "no signing key"', () => {
			const stderr = 'error: no signing key found';
			assert.ok(GitErrors.signingKeyNotAvailable.test(stderr));
		});

		test('gpgNotFound matches POSIX shell "not found"', () => {
			const stderr = 'sh: 1: gpg: not found';
			assert.ok(GitErrors.gpgNotFound.test(stderr));
		});

		test('gpgNotFound matches Windows "not recognized as"', () => {
			const stderr = "'gpg' is not recognized as an internal or external command";
			assert.ok(GitErrors.gpgNotFound.test(stderr));
		});

		test('gpgNotFound matches "cannot run gpg"', () => {
			const stderr = 'error: cannot run gpg: No such file or directory';
			assert.ok(GitErrors.gpgNotFound.test(stderr));
		});

		test('gpgNotFound does NOT match "gpg-agent: signing failed"', () => {
			const stderr = 'gpg-agent: signing failed: Operation cancelled';
			assert.ok(!GitErrors.gpgNotFound.test(stderr));
		});

		test('sshNotFound matches "unable to start ssh-keygen"', () => {
			const stderr = 'error: unable to start ssh-keygen: No such file or directory';
			assert.ok(GitErrors.sshNotFound.test(stderr));
		});

		test('sshNotFound matches Windows "not recognized"', () => {
			const stderr = "'ssh-keygen' is not recognized as an internal or external command";
			assert.ok(GitErrors.sshNotFound.test(stderr));
		});

		test('sshNotFound does NOT match unrelated ssh connection error', () => {
			const stderr = 'ssh: connect to host example.com port 22: Connection refused';
			assert.ok(!GitErrors.sshNotFound.test(stderr));
		});
	});

	suite('classifySigningError', () => {
		test('returns "passphraseFailed" for gpg sign failure stderr', () => {
			const ex = new GitError(
				new RunError({ message: '', cmd: 'git commit', code: 1 }, '', 'error: gpg failed to sign the data'),
			);
			assert.strictEqual(classifySigningError(ex), 'passphraseFailed');
		});

		test('returns "noKey" for "No secret key" stderr', () => {
			const ex = new GitError(
				new RunError({ message: '', cmd: 'git commit', code: 1 }, '', 'gpg: signing failed: No secret key'),
			);
			assert.strictEqual(classifySigningError(ex), 'noKey');
		});

		test('returns "gpgNotFound" for POSIX shell not-found', () => {
			const ex = new GitError(
				new RunError({ message: '', cmd: 'git commit', code: 1 }, '', 'sh: 1: gpg: not found'),
			);
			assert.strictEqual(classifySigningError(ex), 'gpgNotFound');
		});

		test('returns "sshNotFound" for ssh-keygen unavailable', () => {
			const ex = new GitError(
				new RunError(
					{ message: '', cmd: 'git commit', code: 1 },
					'',
					'error: unable to start ssh-keygen: No such file or directory',
				),
			);
			assert.strictEqual(classifySigningError(ex), 'sshNotFound');
		});

		test('returns undefined when stderr is not signing-related', () => {
			const ex = new GitError(
				new RunError(
					{ message: '', cmd: 'git commit', code: 1 },
					'',
					'error: pathspec "foo" did not match any files',
				),
			);
			assert.strictEqual(classifySigningError(ex), undefined);
		});

		test('precedence: "passphraseFailed" wins over "noKey" when both appear', () => {
			// Preserves the ordering from patch.ts's original classifier: the outer
			// "gpg failed to sign" cause takes precedence over the inner "No secret key".
			const ex = new GitError(
				new RunError(
					{ message: '', cmd: 'git commit', code: 1 },
					'',
					'error: gpg failed to sign the data\ngpg: signing failed: No secret key',
				),
			);
			assert.strictEqual(classifySigningError(ex), 'passphraseFailed');
		});

		test('reads Error.message when passed a plain Error (non-GitError)', () => {
			const ex = new Error('error: gpg failed to sign the data');
			assert.strictEqual(classifySigningError(ex), 'passphraseFailed');
		});

		test('returns undefined for null/undefined/empty input', () => {
			assert.strictEqual(classifySigningError(undefined), undefined);
			assert.strictEqual(classifySigningError(null), undefined);
			assert.strictEqual(classifySigningError(''), undefined);
		});
	});

	suite('inferSigningFormatFromError', () => {
		test('returns "ssh" when stderr mentions ssh-keygen', () => {
			const ex = new Error('error: unable to start ssh-keygen');
			assert.strictEqual(inferSigningFormatFromError(ex), 'ssh');
		});

		test('returns "ssh" when stderr mentions gpg.ssh.* config', () => {
			const ex = new Error('error: gpg.ssh.allowedSignersFile is unset');
			assert.strictEqual(inferSigningFormatFromError(ex), 'ssh');
		});

		test('returns "gpg" when stderr mentions gpg but not ssh', () => {
			const ex = new Error('error: gpg failed to sign the data');
			assert.strictEqual(inferSigningFormatFromError(ex), 'gpg');
		});

		test('returns "ssh" when both ssh-keygen and gpg appear (ssh wins)', () => {
			const ex = new Error('error: unable to start ssh-keygen\ngpg: fallback not attempted');
			assert.strictEqual(inferSigningFormatFromError(ex), 'ssh');
		});

		test('returns undefined for unrelated stderr', () => {
			const ex = new Error('fatal: not a git repository');
			assert.strictEqual(inferSigningFormatFromError(ex), undefined);
		});
	});
});
