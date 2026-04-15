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
	| 'user.email'
	| 'user.name'
	| 'user.signingkey';

export type GitConfigKeys =
	| GitCoreConfigKeys
	/** `vscode-merge-base` — value determined by VS Code that is used to determine the merge base for the current branch. Once `gk-merge-base` is determined, we stop using `vscode-merge-base` */
	| `branch.${string}.vscode-merge-base`
	/** `github-pr-owner-number` — value determined by VS Code/GitHub PR extension that is used to determine the PR number for the current branch */
	| `branch.${string}.github-pr-owner-number`;

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
	| 'gk.defaultRemote';

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

	getGkConfig?(
		repoPath: string,
		key: GkConfigKeys | DeprecatedGkConfigKeys,
		options?: { type?: GitConfigType },
	): Promise<string | undefined>;
	getGkConfigRegex?(repoPath: string, pattern: string): Promise<Map<string, string>>;
	setGkConfig?(
		repoPath: string,
		key: GkConfigKeys | DeprecatedGkConfigKeys,
		value: string | undefined,
	): Promise<void>;

	getSigningConfig?(repoPath: string): Promise<SigningConfig>;
	getSigningConfigFlags?(config: SigningConfig): string[];
	setSigningConfig?(repoPath: string, config: Partial<SigningConfig>, options?: { global?: boolean }): Promise<void>;
	validateSigningSetup?(repoPath: string): Promise<ValidationResult>;
}
