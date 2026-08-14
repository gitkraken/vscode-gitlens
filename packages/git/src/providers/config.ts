import type { GkConfigInvalidationTarget } from '../cache.js';
import type { GitDir } from '../models/repository.js';
import type { SigningConfig, ValidationResult } from '../models/signature.js';
import type { GitUser } from '../models/user.js';

export type GitCoreConfigKeys =
	| 'commit.gpgsign'
	| 'core.excludesFile'
	| 'diff.guitool'
	| 'diff.tool'
	| 'gpg.format'
	| 'gpg.program'
	| 'gpg.ssh.program'
	| 'gpg.ssh.allowedSignersFile'
	| 'init.defaultBranch'
	/** `merge.autoStash` — whether `git merge` (and so a merging `git pull`) stashes and reapplies uncommitted changes */
	| 'merge.autoStash'
	/** `pull.autoStash` — overrides `merge.autoStash`/`rebase.autoStash` for `git pull`, in either mode */
	| 'pull.autoStash'
	/** `pull.rebase` — whether `git pull` rebases instead of merging; also accepts `merges`/`interactive` */
	| 'pull.rebase'
	/** `rebase.autoStash` — whether `git rebase` (and so a rebasing `git pull`) stashes and reapplies uncommitted changes */
	| 'rebase.autoStash'
	/** `rebase.updateRefs` — whether `git rebase` also updates branches pointing to the rebased commits */
	| 'rebase.updateRefs'
	| 'user.email'
	| 'user.name'
	| 'user.signingkey';

export type GitConfigKeys =
	| GitCoreConfigKeys
	/** `vscode-merge-base` — value determined by VS Code that is used to determine the merge base for the current branch. Once `gk-merge-base` is determined, we stop using `vscode-merge-base` */
	| `branch.${string}.vscode-merge-base`
	/** `github-pr-owner-number` — value determined by VS Code/GitHub PR extension that is used to determine the PR number for the current branch */
	| `branch.${string}.github-pr-owner-number`
	/** `rebase` — per-branch override of `pull.rebase`; takes precedence over the repository-wide setting */
	| `branch.${string}.rebase`;

export type GkConfigKeys =
	/** `gk-merge-base` — the branch that the current branch was created from (the original base at branch creation time) */
	| `branch.${string}.gk-merge-base`
	/** `gk-merge-target` — the auto-detected branch that the current branch will likely be merged into (used for comparisons, PR targets, etc.) */
	| `branch.${string}.gk-merge-target`
	/** `gk-merge-target-user` — user-specified merge target branch; takes precedence over auto-detected `gk-merge-target` */
	| `branch.${string}.gk-merge-target-user`
	/** `gk-associated-issues` — JSON array of issue/PR entity identifiers linked to this branch */
	| `branch.${string}.gk-associated-issues`
	/** `gk-last-accessed` — ISO 8601 timestamp of when the branch was last checked out or viewed */
	| `branch.${string}.gk-last-accessed`
	/** `gk-last-modified` — ISO 8601 timestamp of when the branch last received a commit */
	| `branch.${string}.gk-last-modified`
	/** `gk-agent-last-activity` — ISO 8601 timestamp of when an AI agent was last active on this branch */
	| `branch.${string}.gk-agent-last-activity`
	/** `gk-disposition` — user-assigned branch disposition: 'starred' or 'archived' */
	| `branch.${string}.gk-disposition`
	/** `gk.defaultRemote` — the user-designated default remote for the repository */
	| 'gk.defaultRemote'
	/** `gk.maintenanceLastRun` — ISO 8601 timestamp of the last auto-tier git-optimization maintenance pass */
	| 'gk.maintenanceLastRun'
	/** `gk.commitGraphDisabled` — `'true'` once the user disables GitLens's automatic commit-graph maintenance for this repo */
	| 'gk.commitGraphDisabled'
	/** `gk.fsmonitorNotApplicable` — `'true'` once FSMonitor failed to enable for this repo, so it's never re-suggested */
	| 'gk.fsmonitorNotApplicable'
	/** `gk.untrackedCacheNotApplicable` — `'true'` once the untracked cache failed git's filesystem probe here, so it's never re-suggested */
	| 'gk.untrackedCacheNotApplicable'
	/**
	 * `gk.applied.*` — Git Health ownership + undo markers under `[gk "applied"]`. Each value is the lever's
	 * prior LOCAL-scope value (so undo restores it exactly) or the literal `unset` sentinel when it was absent;
	 * the marker's mere presence also means "applied by GitLens" (so undo is never offered for a user-enabled
	 * lever). `backgroundMaintenance` is a presence-only ownership flag (registration is global; undo =
	 * unregister), and `maintenanceAuto` holds the prior `maintenance.auto` that `git maintenance start` sets
	 * to false and unregister does not restore.
	 */
	| 'gk.applied.untrackedCache'
	| 'gk.applied.fsmonitor'
	| 'gk.applied.manyFiles'
	| 'gk.applied.skipHash'
	| 'gk.applied.backgroundMaintenance'
	| 'gk.applied.maintenanceAuto'
	/** `git maintenance register` sets `maintenance.strategy` too, and `unregister` does NOT restore it. */
	| 'gk.applied.maintenanceStrategy';

export type DeprecatedGkConfigKeys = `branch.${string}.gk-target-base`;

export type GitConfigType = 'bool' | 'int' | 'bool-or-int' | 'path' | 'expiry-date' | 'color';

export interface GitConfigSubProvider {
	getConfig?(
		repoPath: string | undefined,
		key: GitConfigKeys,
		options?: {
			global?: boolean;
			runGitLocally?: boolean;
			type?: GitConfigType;
		},
	): Promise<string | undefined>;
	getConfigRegex?(
		repoPath: string | undefined,
		pattern: string,
		options?: {
			global?: boolean;
			runGitLocally?: boolean;
		},
	): Promise<Map<string, string>>;
	setConfig?(
		repoPath: string | undefined,
		key: GitConfigKeys,
		value: string | undefined,
		options?: {
			global?: boolean;
			runGitLocally?: boolean;
		},
	): Promise<void>;

	getCurrentUser(repoPath: string): Promise<GitUser | undefined>;
	getDefaultWorktreePath?(repoPath: string): Promise<string | undefined>;
	getGitDir?(repoPath: string): Promise<GitDir | undefined>;
	getRepositoryInfo?(
		cwd: string,
	): Promise<
		| { repoPath: string; gitDir: string; commonGitDir: string | undefined; superprojectPath: string | undefined }
		| [safe: true, repoPath: string]
		| [safe: false]
		| []
	>;

	getGkConfig?(repoPath: string, key: GkConfigKeys | DeprecatedGkConfigKeys): Promise<string | undefined>;
	getGkConfigRegex?(repoPath: string, pattern: string): Promise<Map<string, string>>;
	setGkConfig?(
		repoPath: string,
		key: GkConfigKeys | DeprecatedGkConfigKeys,
		value: string | undefined,
		options?: { skipInvalidation?: readonly GkConfigInvalidationTarget[] },
	): Promise<void>;
	/**
	 * Drops every gk key stored for `ref` — call when a branch stops existing under that name. Deliberately
	 * includes user-owned values (`gk-merge-target-user`, `gk-disposition`, `gk-associated-issues`): the
	 * branch is confirmed gone, and leaving them would hand the next branch reusing that name a dead one's
	 * starred state and issue links. Only call where git guarantees the name is free —
	 * a completed delete.
	 */
	removeGkConfigBranchSection?(repoPath: string, ref: string): Promise<void>;
	/** Moves every gk key stored for `oldRef` to `newRef` — call when a branch is renamed. */
	renameGkConfigBranchSection?(repoPath: string, oldRef: string, newRef: string): Promise<void>;

	getSigningConfig?(repoPath: string): Promise<SigningConfig>;
	getSigningConfigFlags?(config: SigningConfig): string[];
	setSigningConfig?(repoPath: string, config: Partial<SigningConfig>, options?: { global?: boolean }): Promise<void>;
	validateSigningSetup?(repoPath: string): Promise<ValidationResult>;
}
