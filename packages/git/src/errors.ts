import * as l10n from '@vscode/l10n';
import { getNumericFormat } from '@gitlens/utils/date.js';
import type { GitPausedOperationStatus } from './models/pausedOperationStatus.js';

/** The `t` surface a message builder renders through — the real `l10n` for `localizedMessage`, `english` for `message`. */
type Translator = Pick<typeof l10n, 't'>;

function formatEnglish(message: string | { message: string; args?: unknown }, ...args: unknown[]): string {
	// Mirrors @vscode/l10n's own placeholder formatter, minus the bundle lookup
	if (typeof message === 'object') {
		return formatEnglish(message.message, ...(Array.isArray(message.args) ? message.args : [message.args]));
	}

	const values: Record<string, unknown> =
		args.length === 1 && typeof args[0] === 'object' && args[0] != null
			? (args[0] as Record<string, unknown>)
			: (args as unknown as Record<string, unknown>);
	return message.replace(/{([^}]+)}/g, (match, key: string) => {
		const value = values[key];
		return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
			? String(value)
			: match;
	});
}

/** Renders the source (English) string with placeholders substituted, never a translation */
const english: Translator = { t: formatEnglish as typeof l10n.t };

/**
 * stderr patterns git emits that are EXPECTED rather than exceptional — an empty repo, a path that doesn't
 * exist at a revision, a branch with no upstream. The exec layer matches these to decide a command "warned"
 * rather than failed.
 *
 * Matching one does NOT mean the empty output is a valid answer: `noCommits` on a fresh repo genuinely means
 * "no commits", while `notARepository` means the read never happened. Callers must branch on which key
 * matched — see `GitRunCompletion`. Pure patterns with no environment dependency, so this lives here rather
 * than in the CLI provider, where the shared run contract couldn't reference it.
 */
export const GitWarnings = {
	notARepository: /Not a git repository/i,
	outsideRepository: /is outside repository/i,
	noPath: /no such path/i,
	noCommits: /does not have any commits/i,
	notFound: /Path '.*?' does not exist in/i,
	foundButNotInRevision: /Path '.*?' exists on disk, but not in/i,
	headNotABranch: /HEAD does not point to a branch/i,
	noUpstream: /no upstream configured for branch '(.*?)'/i,
	unknownRevision:
		/ambiguous argument '.*?': unknown revision or path not in the working tree|not stored as a remote-tracking branch/i,
	mustRunInWorkTree: /this operation must be run in a work tree/i,
	patchWithConflicts: /Applied patch to '.*?' with conflicts/i,
	noRemoteRepositorySpecified: /No remote repository specified\./i,
	remoteConnectionError: /Could not read from remote repository/i,
	notAGitCommand: /'.+' is not a git command/i,
	tipBehind: /tip of your current branch is behind/i,
} as const;

export type GitWarningKey = keyof typeof GitWarnings;

export interface GitCommandContext {
	readonly repoPath: string;
	readonly args: readonly (string | undefined)[];
}

export abstract class GitCommandError<Details extends { gitCommand?: GitCommandContext }> extends Error {
	static is(ex: unknown): ex is GitCommandError<any> {
		return ex instanceof GitCommandError;
	}

	private _details!: Details;
	get details(): Details {
		return this._details;
	}
	private set details(details: Details) {
		this._details = details;
		this.message = this.buildErrorMessage(details, english);
	}

	/** The translated message for UI. `message` is always the English sentence so logs and stack traces stay searchable — see `getPresentableErrorMessage` */
	get localizedMessage(): string {
		return this.buildErrorMessage(this._details, l10n);
	}

	readonly original?: Error;

	constructor(details: Details, original?: Error) {
		super();
		this.name = new.target.name;
		this.original = original;
		this.details = details;
		Error.captureStackTrace?.(this, new.target);
	}

	// `l10n` deliberately shadows the module-level `@vscode/l10n` import — the `@vscode/l10n-dev` string
	// extractor is syntactic and keys off `l10n.t(...)` call sites, so keeping that spelling keeps every
	// message in the extracted catalog while letting the builder render through either translator.
	protected abstract buildErrorMessage(details: Details, l10n: Translator): string;

	update(changes: Details): this {
		this.details = { ...this.details, ...changes };
		return this;
	}
}

export type GitSearchErrorReason = 'invalidPattern' | 'invalidRef';

export class GitSearchError extends Error {
	static is(ex: unknown): ex is GitSearchError {
		return ex instanceof GitSearchError;
	}

	constructor(
		public readonly original: Error,
		public readonly reason?: GitSearchErrorReason,
		public readonly detail?: string,
	) {
		super(original.message);

		Error.captureStackTrace?.(this, new.target);
	}
}

export type ApplyPatchCommitErrorReason =
	| 'appliedWithConflicts'
	| 'applyFailed'
	| 'checkoutFailed'
	| 'createWorktreeFailed'
	| 'stashFailed'
	| 'wouldOverwriteChanges';
interface ApplyPatchCommitErrorDetails {
	reason?: ApplyPatchCommitErrorReason;
	branch?: string;
	gitCommand?: GitCommandContext;
}

export class ApplyPatchCommitError extends GitCommandError<ApplyPatchCommitErrorDetails> {
	static override is(ex: unknown): ex is ApplyPatchCommitError;
	static override is<R extends ApplyPatchCommitErrorReason>(
		ex: unknown,
		reason: R,
	): ex is ApplyPatchCommitError & { details: { reason: R } };
	static override is(ex: unknown, reason?: ApplyPatchCommitErrorReason): boolean {
		return ex instanceof ApplyPatchCommitError && (reason == null || ex.details.reason === reason);
	}

	override buildErrorMessage(details: ApplyPatchCommitErrorDetails, l10n: Translator): string {
		switch (details.reason) {
			case 'applyFailed':
				return this.original instanceof CherryPickError
					? l10n.t('Unable to apply patch. {0}', this.original.message)
					: l10n.t('Unable to apply patch');
			case 'appliedWithConflicts':
				return l10n.t('Patch applied with conflicts');
			case 'checkoutFailed':
				return this.original instanceof CheckoutError
					? l10n.t(
							"Unable to apply patch as we were unable to checkout the branch '{0}'. {1}",
							String(details.branch),
							this.original.message,
						)
					: l10n.t(
							"Unable to apply patch as we were unable to checkout the branch '{0}'",
							String(details.branch),
						);
			case 'createWorktreeFailed':
				return this.original instanceof WorktreeCreateError
					? l10n.t('Unable to apply patch as we were unable to create a worktree. {0}', this.original.message)
					: l10n.t('Unable to apply patch as we were unable to create a worktree');
			case 'stashFailed':
				return this.original instanceof StashPushError
					? l10n.t(
							'Unable to apply patch as we were unable to stash your working changes. {0}',
							this.original.message,
						)
					: l10n.t('Unable to apply patch as we were unable to stash your working changes');
			case 'wouldOverwriteChanges':
				return l10n.t('Unable to apply patch as some local changes would be overwritten');
			default:
				return l10n.t('Unable to apply patch');
		}
	}
}

export type CommitErrorReason = 'nothingToCommit' | 'conflicts' | 'noUserNameConfigured' | 'other';
interface CommitErrorDetails {
	reason?: CommitErrorReason;
	gitCommand?: GitCommandContext;
}

export class CommitError extends GitCommandError<CommitErrorDetails> {
	static override is(ex: unknown): ex is CommitError;
	static override is<R extends CommitErrorReason>(
		ex: unknown,
		reason: R,
	): ex is CommitError & { details: { reason: R } };
	static override is(ex: unknown, reason?: CommitErrorReason): boolean {
		return ex instanceof CommitError && (reason == null || ex.details.reason === reason);
	}

	protected override buildErrorMessage(details: CommitErrorDetails, l10n: Translator): string {
		const baseMessage = l10n.t('Unable to commit');
		switch (details.reason) {
			case 'nothingToCommit':
				return l10n.t('Unable to commit because there are no staged changes');
			case 'conflicts':
				return l10n.t('Unable to commit because there are unresolved merge conflicts');
			case 'noUserNameConfigured':
				return l10n.t('Please configure your git user name and email before committing');
			default:
				return baseMessage;
		}
	}
}

export class BlameIgnoreRevsFileError extends Error {
	static is(ex: unknown): ex is BlameIgnoreRevsFileError {
		return ex instanceof BlameIgnoreRevsFileError;
	}

	constructor(
		public readonly fileName: string,
		public readonly original?: Error,
	) {
		super(l10n.t("Invalid blame.ignoreRevsFile: '{0}'", fileName));

		Error.captureStackTrace?.(this, new.target);
	}
}

export class BlameIgnoreRevsFileBadRevisionError extends Error {
	static is(ex: unknown): ex is BlameIgnoreRevsFileBadRevisionError {
		return ex instanceof BlameIgnoreRevsFileBadRevisionError;
	}

	constructor(
		public readonly revision: string,
		public readonly original?: Error,
	) {
		super(l10n.t("Invalid revision in blame.ignoreRevsFile: '{0}'", revision));

		Error.captureStackTrace?.(this, new.target);
	}
}

export type BranchErrorReason = 'alreadyExists' | 'notFullyMerged' | 'invalidName' | 'noRemoteReference' | 'other';
type KnownBranchErrorAction =
	| 'create'
	| 'delete'
	| 'force delete'
	| 'rename'
	| 'unset upstream of'
	| `set upstream to '${string}' for`;
interface BranchErrorDetails {
	reason?: BranchErrorReason;
	action?: KnownBranchErrorAction;
	branch?: string;
	gitCommand?: GitCommandContext;
}

export class BranchError extends GitCommandError<BranchErrorDetails> {
	static override is(ex: unknown): ex is BranchError;
	static override is<R extends BranchErrorReason>(
		ex: unknown,
		reason: R,
	): ex is BranchError & { details: { reason: R } };
	static override is(ex: unknown, reason?: BranchErrorReason): boolean {
		return ex instanceof BranchError && (reason == null || ex.details.reason === reason);
	}

	protected override buildErrorMessage(details: BranchErrorDetails, l10n: Translator): string {
		const branch = details.branch;
		const action = details.action;
		if (!branch) {
			switch (action) {
				case 'create':
					return getMissingBranchErrorMessage('create', details.reason, l10n);
				case 'delete':
					return getMissingBranchErrorMessage('delete', details.reason, l10n);
				case 'force delete':
					return getMissingBranchErrorMessage('force delete', details.reason, l10n);
				case 'rename':
					return getMissingBranchErrorMessage('rename', details.reason, l10n);
				case 'unset upstream of':
					return getMissingBranchErrorMessage('unset upstream of', details.reason, l10n);
				default:
					if (action?.startsWith("set upstream to '") && action.endsWith("' for")) {
						return getMissingSetUpstreamBranchErrorMessage(action.slice(17, -5), details.reason, l10n);
					}

					return getGenericBranchErrorMessage(undefined, details.reason, l10n);
			}
		}

		if (action?.startsWith("set upstream to '") && action.endsWith("' for")) {
			const upstream = action.slice(17, -5);
			switch (details.reason) {
				case 'alreadyExists':
					return l10n.t(
						"Unable to set upstream to '{0}' for branch '{1}' because it already exists",
						upstream,
						branch,
					);
				case 'notFullyMerged':
					return l10n.t(
						"Unable to set upstream to '{0}' for branch '{1}' because it is not fully merged",
						upstream,
						branch,
					);
				case 'invalidName':
					return l10n.t(
						"Unable to set upstream to '{0}' for branch '{1}' because the branch name is invalid",
						upstream,
						branch,
					);
				case 'noRemoteReference':
					return l10n.t(
						"Unable to set upstream to '{0}' for branch '{1}' because the remote reference does not exist",
						upstream,
						branch,
					);
				default:
					return l10n.t("Unable to set upstream to '{0}' for branch '{1}'", upstream, branch);
			}
		}

		switch (action) {
			case 'create':
				switch (details.reason) {
					case 'alreadyExists':
						return l10n.t("Unable to create branch '{0}' because it already exists", branch);
					case 'notFullyMerged':
						return l10n.t("Unable to create branch '{0}' because it is not fully merged", branch);
					case 'invalidName':
						return l10n.t("Unable to create branch '{0}' because the branch name is invalid", branch);
					case 'noRemoteReference':
						return l10n.t(
							"Unable to create branch '{0}' because the remote reference does not exist",
							branch,
						);
					default:
						return l10n.t("Unable to create branch '{0}'", branch);
				}
			case 'delete':
				switch (details.reason) {
					case 'alreadyExists':
						return l10n.t("Unable to delete branch '{0}' because it already exists", branch);
					case 'notFullyMerged':
						return l10n.t("Unable to delete branch '{0}' because it is not fully merged", branch);
					case 'invalidName':
						return l10n.t("Unable to delete branch '{0}' because the branch name is invalid", branch);
					case 'noRemoteReference':
						return l10n.t(
							"Unable to delete branch '{0}' because the remote reference does not exist",
							branch,
						);
					default:
						return l10n.t("Unable to delete branch '{0}'", branch);
				}
			case 'force delete':
				switch (details.reason) {
					case 'alreadyExists':
						return l10n.t("Unable to force delete branch '{0}' because it already exists", branch);
					case 'notFullyMerged':
						return l10n.t("Unable to force delete branch '{0}' because it is not fully merged", branch);
					case 'invalidName':
						return l10n.t("Unable to force delete branch '{0}' because the branch name is invalid", branch);
					case 'noRemoteReference':
						return l10n.t(
							"Unable to force delete branch '{0}' because the remote reference does not exist",
							branch,
						);
					default:
						return l10n.t("Unable to force delete branch '{0}'", branch);
				}
			case 'rename':
				switch (details.reason) {
					case 'alreadyExists':
						return l10n.t("Unable to rename branch '{0}' because it already exists", branch);
					case 'notFullyMerged':
						return l10n.t("Unable to rename branch '{0}' because it is not fully merged", branch);
					case 'invalidName':
						return l10n.t("Unable to rename branch '{0}' because the branch name is invalid", branch);
					case 'noRemoteReference':
						return l10n.t(
							"Unable to rename branch '{0}' because the remote reference does not exist",
							branch,
						);
					default:
						return l10n.t("Unable to rename branch '{0}'", branch);
				}
			case 'unset upstream of':
				switch (details.reason) {
					case 'alreadyExists':
						return l10n.t("Unable to unset upstream of branch '{0}' because it already exists", branch);
					case 'notFullyMerged':
						return l10n.t(
							"Unable to unset upstream of branch '{0}' because it is not fully merged",
							branch,
						);
					case 'invalidName':
						return l10n.t(
							"Unable to unset upstream of branch '{0}' because the branch name is invalid",
							branch,
						);
					case 'noRemoteReference':
						return l10n.t(
							"Unable to unset upstream of branch '{0}' because the remote reference does not exist",
							branch,
						);
					default:
						return l10n.t("Unable to unset upstream of branch '{0}'", branch);
				}
			default:
				return getGenericBranchErrorMessage(branch, details.reason, l10n);
		}
	}
}

function getMissingBranchErrorMessage(
	action: Exclude<KnownBranchErrorAction, `set upstream to '${string}' for`>,
	reason: BranchErrorReason | undefined,
	l10n: Translator,
): string {
	switch (action) {
		case 'create':
			switch (reason) {
				case 'alreadyExists':
					return l10n.t('Unable to create branch because it already exists');
				case 'notFullyMerged':
					return l10n.t('Unable to create branch because it is not fully merged');
				case 'invalidName':
					return l10n.t('Unable to create branch because the branch name is invalid');
				case 'noRemoteReference':
					return l10n.t('Unable to create branch because the remote reference does not exist');
				default:
					return l10n.t('Unable to create branch');
			}
		case 'delete':
			switch (reason) {
				case 'alreadyExists':
					return l10n.t('Unable to delete branch because it already exists');
				case 'notFullyMerged':
					return l10n.t('Unable to delete branch because it is not fully merged');
				case 'invalidName':
					return l10n.t('Unable to delete branch because the branch name is invalid');
				case 'noRemoteReference':
					return l10n.t('Unable to delete branch because the remote reference does not exist');
				default:
					return l10n.t('Unable to delete branch');
			}
		case 'force delete':
			switch (reason) {
				case 'alreadyExists':
					return l10n.t('Unable to force delete branch because it already exists');
				case 'notFullyMerged':
					return l10n.t('Unable to force delete branch because it is not fully merged');
				case 'invalidName':
					return l10n.t('Unable to force delete branch because the branch name is invalid');
				case 'noRemoteReference':
					return l10n.t('Unable to force delete branch because the remote reference does not exist');
				default:
					return l10n.t('Unable to force delete branch');
			}
		case 'rename':
			switch (reason) {
				case 'alreadyExists':
					return l10n.t('Unable to rename branch because it already exists');
				case 'notFullyMerged':
					return l10n.t('Unable to rename branch because it is not fully merged');
				case 'invalidName':
					return l10n.t('Unable to rename branch because the branch name is invalid');
				case 'noRemoteReference':
					return l10n.t('Unable to rename branch because the remote reference does not exist');
				default:
					return l10n.t('Unable to rename branch');
			}
		case 'unset upstream of':
			switch (reason) {
				case 'alreadyExists':
					return l10n.t('Unable to unset upstream of branch because it already exists');
				case 'notFullyMerged':
					return l10n.t('Unable to unset upstream of branch because it is not fully merged');
				case 'invalidName':
					return l10n.t('Unable to unset upstream of branch because the branch name is invalid');
				case 'noRemoteReference':
					return l10n.t('Unable to unset upstream of branch because the remote reference does not exist');
				default:
					return l10n.t('Unable to unset upstream of branch');
			}
	}
}

function getMissingSetUpstreamBranchErrorMessage(
	upstream: string,
	reason: BranchErrorReason | undefined,
	l10n: Translator,
): string {
	switch (reason) {
		case 'alreadyExists':
			return l10n.t("Unable to set upstream to '{0}' for branch because it already exists", upstream);
		case 'notFullyMerged':
			return l10n.t("Unable to set upstream to '{0}' for branch because it is not fully merged", upstream);
		case 'invalidName':
			return l10n.t("Unable to set upstream to '{0}' for branch because the branch name is invalid", upstream);
		case 'noRemoteReference':
			return l10n.t(
				"Unable to set upstream to '{0}' for branch because the remote reference does not exist",
				upstream,
			);
		default:
			return l10n.t("Unable to set upstream to '{0}' for branch", upstream);
	}
}

function getGenericBranchErrorMessage(
	branch: string | undefined,
	reason: BranchErrorReason | undefined,
	l10n: Translator,
): string {
	if (branch) {
		switch (reason) {
			case 'alreadyExists':
				return l10n.t("Unable to perform action with branch '{0}' because it already exists", branch);
			case 'notFullyMerged':
				return l10n.t("Unable to perform action with branch '{0}' because it is not fully merged", branch);
			case 'invalidName':
				return l10n.t("Unable to perform action with branch '{0}' because the branch name is invalid", branch);
			case 'noRemoteReference':
				return l10n.t(
					"Unable to perform action with branch '{0}' because the remote reference does not exist",
					branch,
				);
			default:
				return l10n.t("Unable to perform action with branch '{0}'", branch);
		}
	}

	switch (reason) {
		case 'alreadyExists':
			return l10n.t('Unable to perform action on branch because it already exists');
		case 'notFullyMerged':
			return l10n.t('Unable to perform action on branch because it is not fully merged');
		case 'invalidName':
			return l10n.t('Unable to perform action on branch because the branch name is invalid');
		case 'noRemoteReference':
			return l10n.t('Unable to perform action on branch because the remote reference does not exist');
		default:
			return l10n.t('Unable to perform action on branch');
	}
}

export type CheckoutErrorReason = 'invalidRef' | 'pathspecNotFound' | 'wouldOverwriteChanges' | 'other';
interface CheckoutErrorDetails {
	reason?: CheckoutErrorReason;
	ref?: string;
	gitCommand?: GitCommandContext;
}

export class CheckoutError extends GitCommandError<CheckoutErrorDetails> {
	static override is(ex: unknown): ex is CheckoutError;
	static override is<R extends CheckoutErrorReason>(
		ex: unknown,
		reason: R,
	): ex is CheckoutError & { details: { reason: R } };
	static override is(ex: unknown, reason?: CheckoutErrorReason): boolean {
		return ex instanceof CheckoutError && (reason == null || ex.details.reason === reason);
	}

	protected override buildErrorMessage(details: CheckoutErrorDetails, l10n: Translator): string {
		switch (details.reason) {
			case 'invalidRef':
				return details.ref
					? l10n.t("Unable to checkout '{0}' because the reference is invalid", details.ref)
					: l10n.t('Unable to checkout because the reference is invalid');
			case 'pathspecNotFound':
				return details.ref
					? l10n.t("Unable to checkout '{0}' because the path or reference does not exist", details.ref)
					: l10n.t('Unable to checkout because the path or reference does not exist');
			case 'wouldOverwriteChanges':
				return details.ref
					? l10n.t(
							"Unable to checkout '{0}'. Your local changes would be overwritten. Please commit or stash your changes before switching branches.",
							details.ref,
						)
					: l10n.t(
							'Unable to checkout. Your local changes would be overwritten. Please commit or stash your changes before switching branches.',
						);
			default:
				return details.ref ? l10n.t("Unable to checkout '{0}'", details.ref) : l10n.t('Unable to checkout');
		}
	}
}

export type CherryPickErrorReason =
	| 'aborted'
	| 'alreadyInProgress'
	| 'conflicts'
	| 'emptyCommit'
	| 'wouldOverwriteChanges'
	| 'other';
interface CherryPickErrorDetails {
	reason?: CherryPickErrorReason;
	revs?: string[];
	gitCommand?: GitCommandContext;
}

export class CherryPickError extends GitCommandError<CherryPickErrorDetails> {
	static override is(ex: unknown): ex is CherryPickError;
	static override is<R extends CherryPickErrorReason>(
		ex: unknown,
		reason: R,
	): ex is CherryPickError & { details: { reason: R } };
	static override is(ex: unknown, reason?: CherryPickErrorReason): boolean {
		return ex instanceof CherryPickError && (reason == null || ex.details.reason === reason);
	}

	protected override buildErrorMessage(details: CherryPickErrorDetails, l10n: Translator): string {
		if (details.revs?.length === 1) {
			const rev = details.revs[0];
			switch (details.reason) {
				case 'aborted':
					return l10n.t("Unable to cherry-pick commit '{0}' as it was aborted.", rev);
				case 'alreadyInProgress':
					return l10n.t("Unable to cherry-pick commit '{0}' as a cherry-pick is already in progress.", rev);
				case 'conflicts':
					return l10n.t("Unable to cherry-pick commit '{0}' due to conflicts.", rev);
				case 'emptyCommit':
					return l10n.t("Unable to cherry-pick commit '{0}' because it is an empty commit.", rev);
				case 'wouldOverwriteChanges':
					return l10n.t(
						"Unable to cherry-pick commit '{0}' as some local changes would be overwritten.",
						rev,
					);
				default:
					return l10n.t("Unable to cherry-pick commit '{0}'", rev);
			}
		}

		if (details.revs?.length) {
			const count = getNumericFormat()(details.revs.length);
			switch (details.reason) {
				case 'aborted':
					return l10n.t('Unable to cherry-pick {0} commits as it was aborted.', count);
				case 'alreadyInProgress':
					return l10n.t('Unable to cherry-pick {0} commits as a cherry-pick is already in progress.', count);
				case 'conflicts':
					return l10n.t('Unable to cherry-pick {0} commits due to conflicts.', count);
				case 'emptyCommit':
					return l10n.t('Unable to cherry-pick {0} commits because it is an empty commit.', count);
				case 'wouldOverwriteChanges':
					return l10n.t(
						'Unable to cherry-pick {0} commits as some local changes would be overwritten.',
						count,
					);
				default:
					return l10n.t('Unable to cherry-pick {0} commits', count);
			}
		}

		switch (details.reason) {
			case 'aborted':
				return l10n.t('Unable to cherry-pick as it was aborted.');
			case 'alreadyInProgress':
				return l10n.t('Unable to cherry-pick as a cherry-pick is already in progress.');
			case 'conflicts':
				return l10n.t('Unable to cherry-pick due to conflicts.');
			case 'emptyCommit':
				return l10n.t('Unable to cherry-pick because it is an empty commit.');
			case 'wouldOverwriteChanges':
				return l10n.t('Unable to cherry-pick as some local changes would be overwritten.');
			default:
				return l10n.t('Unable to cherry-pick');
		}
	}
}

export type FetchErrorReason = 'noFastForward' | 'noRemote' | 'remoteConnectionFailed' | 'other';
interface FetchErrorDetails {
	reason?: FetchErrorReason;
	branch?: string;
	remote?: string;
	gitCommand?: GitCommandContext;
}

export class FetchError extends GitCommandError<FetchErrorDetails> {
	static override is(ex: unknown): ex is FetchError;
	static override is<R extends FetchErrorReason>(
		ex: unknown,
		reason: R,
	): ex is FetchError & { details: { reason: R } };
	static override is(ex: unknown, reason?: FetchErrorReason): boolean {
		return ex instanceof FetchError && (reason == null || ex.details.reason === reason);
	}

	protected override buildErrorMessage(details: FetchErrorDetails, l10n: Translator): string {
		if (details.branch && details.remote) {
			switch (details.reason) {
				case 'noFastForward':
					return l10n.t(
						"Unable to fetch branch '{0}' from {1} as it cannot be fast-forwarded",
						details.branch,
						details.remote,
					);
				case 'noRemote':
					return l10n.t(
						"Unable to fetch branch '{0}' from {1} without a remote repository specified.",
						details.branch,
						details.remote,
					);
				case 'remoteConnectionFailed':
					return l10n.t(
						"Unable to fetch branch '{0}' from {1}. Could not connect to the remote repository.",
						details.branch,
						details.remote,
					);
				default:
					return l10n.t("Unable to fetch branch '{0}' from {1}", details.branch, details.remote);
			}
		}

		if (details.branch) {
			switch (details.reason) {
				case 'noFastForward':
					return l10n.t("Unable to fetch branch '{0}' as it cannot be fast-forwarded", details.branch);
				case 'noRemote':
					return l10n.t(
						"Unable to fetch branch '{0}' without a remote repository specified.",
						details.branch,
					);
				case 'remoteConnectionFailed':
					return l10n.t(
						"Unable to fetch branch '{0}'. Could not connect to the remote repository.",
						details.branch,
					);
				default:
					return l10n.t("Unable to fetch branch '{0}'", details.branch);
			}
		}

		if (details.remote) {
			switch (details.reason) {
				case 'noFastForward':
					return l10n.t('Unable to fetch from {0} as it cannot be fast-forwarded', details.remote);
				case 'noRemote':
					return l10n.t('Unable to fetch from {0} without a remote repository specified.', details.remote);
				case 'remoteConnectionFailed':
					return l10n.t(
						'Unable to fetch from {0}. Could not connect to the remote repository.',
						details.remote,
					);
				default:
					return l10n.t('Unable to fetch from {0}', details.remote);
			}
		}

		switch (details.reason) {
			case 'noFastForward':
				return l10n.t('Unable to fetch as it cannot be fast-forwarded');
			case 'noRemote':
				return l10n.t('Unable to fetch without a remote repository specified.');
			case 'remoteConnectionFailed':
				return l10n.t('Unable to fetch. Could not connect to the remote repository.');
			default:
				return l10n.t('Unable to fetch');
		}
	}
}

export type MergeErrorReason =
	| 'aborted'
	| 'alreadyInProgress'
	| 'conflicts'
	| 'uncommittedChanges'
	| 'wouldOverwriteChanges'
	| 'other';
interface MergeErrorDetails {
	reason?: MergeErrorReason;
	ref?: string;
	gitCommand?: GitCommandContext;
}
export class MergeError extends GitCommandError<MergeErrorDetails> {
	static override is(ex: unknown): ex is MergeError;
	static override is<R extends MergeErrorReason>(
		ex: unknown,
		reason: R,
	): ex is MergeError & { details: { reason: R } };
	static override is(ex: unknown, reason?: MergeErrorReason): boolean {
		return ex instanceof MergeError && (reason == null || ex.details.reason === reason);
	}

	protected override buildErrorMessage(details: MergeErrorDetails, l10n: Translator): string {
		if (details.ref) {
			switch (details.reason) {
				case 'aborted':
					return l10n.t("Merge of '{0}' was aborted", details.ref);
				case 'alreadyInProgress':
					return l10n.t("Unable to merge '{0}' because a merge is already in progress", details.ref);
				case 'conflicts':
					return l10n.t(
						"Unable to merge '{0}' due to conflicts. Resolve the conflicts first and continue the merge",
						details.ref,
					);
				case 'uncommittedChanges':
					return l10n.t("Unable to merge '{0}' because there are uncommitted changes", details.ref);
				case 'wouldOverwriteChanges':
					return l10n.t("Unable to merge '{0}' because some local changes would be overwritten", details.ref);
				default:
					return l10n.t("Unable to merge '{0}'", details.ref);
			}
		}

		switch (details.reason) {
			case 'aborted':
				return l10n.t('Merge was aborted');
			case 'alreadyInProgress':
				return l10n.t('Unable to merge because a merge is already in progress');
			case 'conflicts':
				return l10n.t('Unable to merge due to conflicts. Resolve the conflicts first and continue the merge');
			case 'uncommittedChanges':
				return l10n.t('Unable to merge because there are uncommitted changes');
			case 'wouldOverwriteChanges':
				return l10n.t('Unable to merge because some local changes would be overwritten');
			default:
				return l10n.t('Unable to merge');
		}
	}
}

export type PausedOperationAbortErrorReason = 'nothingToAbort';
interface PausedOperationAbortErrorDetails {
	reason?: PausedOperationAbortErrorReason;
	operation: GitPausedOperationStatus;
	gitCommand?: GitCommandContext;
}

export class PausedOperationAbortError extends GitCommandError<PausedOperationAbortErrorDetails> {
	static override is(ex: unknown): ex is PausedOperationAbortError;
	static override is<R extends PausedOperationAbortErrorReason>(
		ex: unknown,
		reason: R,
	): ex is PausedOperationAbortError & { details: { reason: R } };
	static override is(ex: unknown, reason?: PausedOperationAbortErrorReason): boolean {
		return ex instanceof PausedOperationAbortError && (reason == null || ex.details.reason === reason);
	}

	protected override buildErrorMessage(details: PausedOperationAbortErrorDetails, l10n: Translator): string {
		switch (details.operation.type) {
			case 'cherry-pick':
				if (details.reason === 'nothingToAbort') {
					return l10n.t('Cannot abort as there is no cherry-pick operation in progress');
				}

				return this.original
					? l10n.t('Unable to abort the cherry-pick operation: {0}', this.original.message)
					: l10n.t('Unable to abort the cherry-pick operation');
			case 'merge':
				if (details.reason === 'nothingToAbort') {
					return l10n.t('Cannot abort as there is no merge operation in progress');
				}

				return this.original
					? l10n.t('Unable to abort the merge operation: {0}', this.original.message)
					: l10n.t('Unable to abort the merge operation');
			case 'rebase':
				if (details.reason === 'nothingToAbort') {
					return l10n.t('Cannot abort as there is no rebase operation in progress');
				}

				return this.original
					? l10n.t('Unable to abort the rebase operation: {0}', this.original.message)
					: l10n.t('Unable to abort the rebase operation');
			case 'revert':
				if (details.reason === 'nothingToAbort') {
					return l10n.t('Cannot abort as there is no revert operation in progress');
				}

				return this.original
					? l10n.t('Unable to abort the revert operation: {0}', this.original.message)
					: l10n.t('Unable to abort the revert operation');
		}
	}
}

export type PausedOperationContinueErrorReason =
	| 'conflicts'
	| 'emptyCommit'
	| 'messageEditFailed'
	| 'nothingToContinue'
	| 'uncommittedChanges'
	| 'unmergedFiles'
	| 'unstagedChanges'
	| 'wouldOverwriteChanges';
interface PausedOperationContinueErrorDetails {
	reason?: PausedOperationContinueErrorReason;
	operation: GitPausedOperationStatus;
	skip?: boolean;
	gitCommand?: GitCommandContext;
}

export class PausedOperationContinueError extends GitCommandError<PausedOperationContinueErrorDetails> {
	static override is(ex: unknown): ex is PausedOperationContinueError;
	static override is<R extends PausedOperationContinueErrorReason>(
		ex: unknown,
		reason: R,
	): ex is PausedOperationContinueError & { details: { reason: R } };
	static override is(ex: unknown, reason?: PausedOperationContinueErrorReason): boolean {
		return ex instanceof PausedOperationContinueError && (reason == null || ex.details.reason === reason);
	}

	protected override buildErrorMessage(details: PausedOperationContinueErrorDetails, l10n: Translator): string {
		switch (details.operation.type) {
			case 'cherry-pick':
				return getCherryPickContinueErrorMessage(details.reason, details.skip ?? false, this.original, l10n);
			case 'merge':
				return getMergeContinueErrorMessage(details.reason, details.skip ?? false, this.original, l10n);
			case 'rebase':
				return getRebaseContinueErrorMessage(details.reason, details.skip ?? false, this.original, l10n);
			case 'revert':
				return getRevertContinueErrorMessage(details.reason, details.skip ?? false, this.original, l10n);
		}
	}
}

function getCherryPickContinueErrorMessage(
	reason: PausedOperationContinueErrorReason | undefined,
	skip: boolean,
	original: Error | undefined,
	l10n: Translator,
): string {
	if (skip) {
		switch (reason) {
			case 'conflicts':
				return l10n.t('Cannot skip the cherry-pick operation as there are unresolved conflicts');
			case 'emptyCommit':
				return l10n.t('Cannot skip the cherry-pick operation as the previous commit is empty');
			case 'messageEditFailed':
				return l10n.t(
					'Cannot skip the cherry-pick operation as a commit message needs to be edited and the editor could not be opened',
				);
			case 'nothingToContinue':
				return l10n.t('Cannot skip the cherry-pick operation as there is no cherry-pick in progress');
			case 'uncommittedChanges':
				return l10n.t('Cannot skip the cherry-pick operation as there are uncommitted changes');
			case 'unmergedFiles':
				return l10n.t('Cannot skip the cherry-pick operation as there are unmerged files');
			case 'unstagedChanges':
				return l10n.t('Cannot skip the cherry-pick operation as there are unstaged changes');
			case 'wouldOverwriteChanges':
				return l10n.t('Cannot skip the cherry-pick operation as some local changes would be overwritten');
			default:
				return original
					? l10n.t('Unable to skip the cherry-pick operation: {0}', original.message)
					: l10n.t('Unable to skip the cherry-pick operation');
		}
	}

	switch (reason) {
		case 'conflicts':
			return l10n.t('Cannot continue the cherry-pick operation as there are unresolved conflicts');
		case 'emptyCommit':
			return l10n.t('Cannot continue the cherry-pick operation as the previous commit is empty');
		case 'messageEditFailed':
			return l10n.t(
				'Cannot continue the cherry-pick operation as a commit message needs to be edited and the editor could not be opened',
			);
		case 'nothingToContinue':
			return l10n.t('Cannot continue the cherry-pick operation as there is no cherry-pick in progress');
		case 'uncommittedChanges':
			return l10n.t('Cannot continue the cherry-pick operation as there are uncommitted changes');
		case 'unmergedFiles':
			return l10n.t('Cannot continue the cherry-pick operation as there are unmerged files');
		case 'unstagedChanges':
			return l10n.t('Cannot continue the cherry-pick operation as there are unstaged changes');
		case 'wouldOverwriteChanges':
			return l10n.t('Cannot continue the cherry-pick operation as some local changes would be overwritten');
		default:
			return original
				? l10n.t('Unable to continue the cherry-pick operation: {0}', original.message)
				: l10n.t('Unable to continue the cherry-pick operation');
	}
}

function getMergeContinueErrorMessage(
	reason: PausedOperationContinueErrorReason | undefined,
	skip: boolean,
	original: Error | undefined,
	l10n: Translator,
): string {
	if (skip) {
		switch (reason) {
			case 'conflicts':
				return l10n.t('Cannot skip the merge operation as there are unresolved conflicts');
			case 'emptyCommit':
				return l10n.t('Cannot skip the merge operation as the previous commit is empty');
			case 'messageEditFailed':
				return l10n.t(
					'Cannot skip the merge operation as a commit message needs to be edited and the editor could not be opened',
				);
			case 'nothingToContinue':
				return l10n.t('Cannot skip the merge operation as there is no merge in progress');
			case 'uncommittedChanges':
				return l10n.t('Cannot skip the merge operation as there are uncommitted changes');
			case 'unmergedFiles':
				return l10n.t('Cannot skip the merge operation as there are unmerged files');
			case 'unstagedChanges':
				return l10n.t('Cannot skip the merge operation as there are unstaged changes');
			case 'wouldOverwriteChanges':
				return l10n.t('Cannot skip the merge operation as some local changes would be overwritten');
			default:
				return original
					? l10n.t('Unable to skip the merge operation: {0}', original.message)
					: l10n.t('Unable to skip the merge operation');
		}
	}

	switch (reason) {
		case 'conflicts':
			return l10n.t('Cannot continue the merge operation as there are unresolved conflicts');
		case 'emptyCommit':
			return l10n.t('Cannot continue the merge operation as the previous commit is empty');
		case 'messageEditFailed':
			return l10n.t(
				'Cannot continue the merge operation as a commit message needs to be edited and the editor could not be opened',
			);
		case 'nothingToContinue':
			return l10n.t('Cannot continue the merge operation as there is no merge in progress');
		case 'uncommittedChanges':
			return l10n.t('Cannot continue the merge operation as there are uncommitted changes');
		case 'unmergedFiles':
			return l10n.t('Cannot continue the merge operation as there are unmerged files');
		case 'unstagedChanges':
			return l10n.t('Cannot continue the merge operation as there are unstaged changes');
		case 'wouldOverwriteChanges':
			return l10n.t('Cannot continue the merge operation as some local changes would be overwritten');
		default:
			return original
				? l10n.t('Unable to continue the merge operation: {0}', original.message)
				: l10n.t('Unable to continue the merge operation');
	}
}

function getRebaseContinueErrorMessage(
	reason: PausedOperationContinueErrorReason | undefined,
	skip: boolean,
	original: Error | undefined,
	l10n: Translator,
): string {
	if (skip) {
		switch (reason) {
			case 'conflicts':
				return l10n.t('Cannot skip the rebase operation as there are unresolved conflicts');
			case 'emptyCommit':
				return l10n.t('Cannot skip the rebase operation as the previous commit is empty');
			case 'messageEditFailed':
				return l10n.t(
					'Cannot skip the rebase operation as a commit message needs to be edited and the editor could not be opened',
				);
			case 'nothingToContinue':
				return l10n.t('Cannot skip the rebase operation as there is no rebase in progress');
			case 'uncommittedChanges':
				return l10n.t('Cannot skip the rebase operation as there are uncommitted changes');
			case 'unmergedFiles':
				return l10n.t('Cannot skip the rebase operation as there are unmerged files');
			case 'unstagedChanges':
				return l10n.t('Cannot skip the rebase operation as there are unstaged changes');
			case 'wouldOverwriteChanges':
				return l10n.t('Cannot skip the rebase operation as some local changes would be overwritten');
			default:
				return original
					? l10n.t('Unable to skip the rebase operation: {0}', original.message)
					: l10n.t('Unable to skip the rebase operation');
		}
	}

	switch (reason) {
		case 'conflicts':
			return l10n.t('Cannot continue the rebase operation as there are unresolved conflicts');
		case 'emptyCommit':
			return l10n.t('Cannot continue the rebase operation as the previous commit is empty');
		case 'messageEditFailed':
			return l10n.t(
				'Cannot continue the rebase operation as a commit message needs to be edited and the editor could not be opened',
			);
		case 'nothingToContinue':
			return l10n.t('Cannot continue the rebase operation as there is no rebase in progress');
		case 'uncommittedChanges':
			return l10n.t('Cannot continue the rebase operation as there are uncommitted changes');
		case 'unmergedFiles':
			return l10n.t('Cannot continue the rebase operation as there are unmerged files');
		case 'unstagedChanges':
			return l10n.t('Cannot continue the rebase operation as there are unstaged changes');
		case 'wouldOverwriteChanges':
			return l10n.t('Cannot continue the rebase operation as some local changes would be overwritten');
		default:
			return original
				? l10n.t('Unable to continue the rebase operation: {0}', original.message)
				: l10n.t('Unable to continue the rebase operation');
	}
}

function getRevertContinueErrorMessage(
	reason: PausedOperationContinueErrorReason | undefined,
	skip: boolean,
	original: Error | undefined,
	l10n: Translator,
): string {
	if (skip) {
		switch (reason) {
			case 'conflicts':
				return l10n.t('Cannot skip the revert operation as there are unresolved conflicts');
			case 'emptyCommit':
				return l10n.t('Cannot skip the revert operation as the previous commit is empty');
			case 'messageEditFailed':
				return l10n.t(
					'Cannot skip the revert operation as a commit message needs to be edited and the editor could not be opened',
				);
			case 'nothingToContinue':
				return l10n.t('Cannot skip the revert operation as there is no revert in progress');
			case 'uncommittedChanges':
				return l10n.t('Cannot skip the revert operation as there are uncommitted changes');
			case 'unmergedFiles':
				return l10n.t('Cannot skip the revert operation as there are unmerged files');
			case 'unstagedChanges':
				return l10n.t('Cannot skip the revert operation as there are unstaged changes');
			case 'wouldOverwriteChanges':
				return l10n.t('Cannot skip the revert operation as some local changes would be overwritten');
			default:
				return original
					? l10n.t('Unable to skip the revert operation: {0}', original.message)
					: l10n.t('Unable to skip the revert operation');
		}
	}

	switch (reason) {
		case 'conflicts':
			return l10n.t('Cannot continue the revert operation as there are unresolved conflicts');
		case 'emptyCommit':
			return l10n.t('Cannot continue the revert operation as the previous commit is empty');
		case 'messageEditFailed':
			return l10n.t(
				'Cannot continue the revert operation as a commit message needs to be edited and the editor could not be opened',
			);
		case 'nothingToContinue':
			return l10n.t('Cannot continue the revert operation as there is no revert in progress');
		case 'uncommittedChanges':
			return l10n.t('Cannot continue the revert operation as there are uncommitted changes');
		case 'unmergedFiles':
			return l10n.t('Cannot continue the revert operation as there are unmerged files');
		case 'unstagedChanges':
			return l10n.t('Cannot continue the revert operation as there are unstaged changes');
		case 'wouldOverwriteChanges':
			return l10n.t('Cannot continue the revert operation as some local changes would be overwritten');
		default:
			return original
				? l10n.t('Unable to continue the revert operation: {0}', original.message)
				: l10n.t('Unable to continue the revert operation');
	}
}

export type PullErrorReason =
	| 'conflict'
	| 'gitIdentity'
	| 'rebaseMultipleBranches'
	| 'refLocked'
	| 'remoteConnectionFailed'
	| 'tagConflict'
	| 'uncommittedChanges'
	| 'unmergedFiles'
	| 'unstagedChanges'
	| 'wouldOverwriteChanges'
	| 'other';
interface PullErrorDetails {
	reason?: PullErrorReason;
	gitCommand?: GitCommandContext;
}

export class PullError extends GitCommandError<PullErrorDetails> {
	static override is(ex: unknown): ex is PullError;
	static override is<R extends PullErrorReason>(ex: unknown, reason: R): ex is PullError & { details: { reason: R } };
	static override is(ex: unknown, reason?: PullErrorReason): boolean {
		return ex instanceof PullError && (reason == null || ex.details.reason === reason);
	}

	protected override buildErrorMessage(details: PullErrorDetails, l10n: Translator): string {
		switch (details.reason) {
			case 'conflict':
				return l10n.t('Unable to complete pull due to conflicts which must be resolved.');
			case 'gitIdentity':
				return l10n.t('Unable to pull because you have not yet set up your Git identity.');
			case 'rebaseMultipleBranches':
				return l10n.t('Unable to pull because you are trying to rebase onto multiple branches.');
			case 'refLocked':
				return l10n.t('Unable to pull because a local ref could not be updated.');
			case 'remoteConnectionFailed':
				return l10n.t('Unable to pull because the remote repository could not be reached.');
			case 'tagConflict':
				return l10n.t('Unable to pull because a local tag would be overwritten.');
			case 'uncommittedChanges':
				return l10n.t('Unable to pull because you have uncommitted changes.');
			case 'unmergedFiles':
				return l10n.t('Unable to pull because you have unmerged files.');
			case 'unstagedChanges':
				return l10n.t('Unable to pull because you have unstaged changes.');
			case 'wouldOverwriteChanges':
				return l10n.t('Unable to pull because local changes to some files would be overwritten.');
			default:
				return l10n.t('Unable to pull');
		}
	}
}

export type PushErrorReason =
	| 'noUpstream'
	| 'permissionDenied'
	| 'rejected'
	| 'rejectedRefDoesNotExist'
	| 'rejectedWithLease'
	| 'rejectedWithLeaseIfIncludes'
	| 'remoteAhead'
	| 'remoteConnectionFailed'
	| 'tipBehind'
	| 'other';
interface PushErrorDetails {
	reason?: PushErrorReason;
	branch?: string;
	remote?: string;
	gitCommand?: GitCommandContext;
}

export class PushError extends GitCommandError<PushErrorDetails> {
	static override is(ex: unknown): ex is PushError;
	static override is<R extends PushErrorReason>(ex: unknown, reason: R): ex is PushError & { details: { reason: R } };
	static override is(ex: unknown, reason?: PushErrorReason): boolean {
		return ex instanceof PushError && (reason == null || ex.details.reason === reason);
	}

	protected override buildErrorMessage(details: PushErrorDetails, l10n: Translator): string {
		if (details.branch && details.remote) {
			switch (details.reason) {
				case 'noUpstream':
					return l10n.t(
						"Unable to push branch '{0}' to {1} because it has no upstream branch.",
						details.branch,
						details.remote,
					);
				case 'permissionDenied':
					return l10n.t(
						"Unable to push branch '{0}' to {1} because you don't have permission to push to this remote repository.",
						details.branch,
						details.remote,
					);
				case 'rejected':
					return l10n.t(
						"Unable to push branch '{0}' to {1} because some refs failed to push or the push was rejected. Try pulling first.",
						details.branch,
						details.remote,
					);
				case 'rejectedRefDoesNotExist':
					return l10n.t(
						"Unable to delete remote branch '{0}' from {1}, the remote reference does not exist",
						details.branch,
						details.remote,
					);
				case 'rejectedWithLease':
				case 'rejectedWithLeaseIfIncludes':
					return l10n.t(
						"Unable to force push branch '{0}' to {1} because some refs failed to push or the push was rejected. The tip of the remote-tracking branch has been updated since the last checkout. Try pulling first.",
						details.branch,
						details.remote,
					);
				case 'remoteAhead':
					return l10n.t(
						"Unable to push branch '{0}' to {1} because the remote contains work that you do not have locally. Try fetching first.",
						details.branch,
						details.remote,
					);
				case 'remoteConnectionFailed':
					return l10n.t(
						"Unable to push branch '{0}' to {1} because the remote repository could not be reached.",
						details.branch,
						details.remote,
					);
				case 'tipBehind':
					return l10n.t(
						"Unable to push branch '{0}' to {1} as it is behind its remote counterpart. Try pulling first.",
						details.branch,
						details.remote,
					);
				default:
					return l10n.t("Unable to push branch '{0}' to {1}", details.branch, details.remote);
			}
		}

		if (details.branch) {
			switch (details.reason) {
				case 'noUpstream':
					return l10n.t("Unable to push branch '{0}' because it has no upstream branch.", details.branch);
				case 'permissionDenied':
					return l10n.t(
						"Unable to push branch '{0}' because you don't have permission to push to this remote repository.",
						details.branch,
					);
				case 'rejected':
					return l10n.t(
						"Unable to push branch '{0}' because some refs failed to push or the push was rejected. Try pulling first.",
						details.branch,
					);
				case 'rejectedRefDoesNotExist':
					return l10n.t(
						"Unable to delete remote branch '{0}', the remote reference does not exist",
						details.branch,
					);
				case 'rejectedWithLease':
				case 'rejectedWithLeaseIfIncludes':
					return l10n.t(
						"Unable to force push branch '{0}' because some refs failed to push or the push was rejected. The tip of the remote-tracking branch has been updated since the last checkout. Try pulling first.",
						details.branch,
					);
				case 'remoteAhead':
					return l10n.t(
						"Unable to push branch '{0}' because the remote contains work that you do not have locally. Try fetching first.",
						details.branch,
					);
				case 'remoteConnectionFailed':
					return l10n.t(
						"Unable to push branch '{0}' because the remote repository could not be reached.",
						details.branch,
					);
				case 'tipBehind':
					return l10n.t(
						"Unable to push branch '{0}' as it is behind its remote counterpart. Try pulling first.",
						details.branch,
					);
				default:
					return l10n.t("Unable to push branch '{0}'", details.branch);
			}
		}

		if (details.remote) {
			switch (details.reason) {
				case 'noUpstream':
					return l10n.t('Unable to push to {0} because it has no upstream branch.', details.remote);
				case 'permissionDenied':
					return l10n.t(
						"Unable to push to {0} because you don't have permission to push to this remote repository.",
						details.remote,
					);
				case 'rejected':
					return l10n.t(
						'Unable to push to {0} because some refs failed to push or the push was rejected. Try pulling first.',
						details.remote,
					);
				case 'rejectedRefDoesNotExist':
					return l10n.t(
						'Unable to delete remote branch from {0}, the remote reference does not exist',
						details.remote,
					);
				case 'rejectedWithLease':
				case 'rejectedWithLeaseIfIncludes':
					return l10n.t(
						'Unable to force push to {0} because some refs failed to push or the push was rejected. The tip of the remote-tracking branch has been updated since the last checkout. Try pulling first.',
						details.remote,
					);
				case 'remoteAhead':
					return l10n.t(
						'Unable to push to {0} because the remote contains work that you do not have locally. Try fetching first.',
						details.remote,
					);
				case 'remoteConnectionFailed':
					return l10n.t(
						'Unable to push to {0} because the remote repository could not be reached.',
						details.remote,
					);
				case 'tipBehind':
					return l10n.t(
						'Unable to push to {0} as it is behind its remote counterpart. Try pulling first.',
						details.remote,
					);
				default:
					return l10n.t('Unable to push to {0}', details.remote);
			}
		}

		switch (details.reason) {
			case 'noUpstream':
				return l10n.t('Unable to push because it has no upstream branch.');
			case 'permissionDenied':
				return l10n.t("Unable to push because you don't have permission to push to this remote repository.");
			case 'rejected':
				return l10n.t(
					'Unable to push because some refs failed to push or the push was rejected. Try pulling first.',
				);
			case 'rejectedRefDoesNotExist':
				return l10n.t('Unable to delete remote branch, the remote reference does not exist');
			case 'rejectedWithLease':
			case 'rejectedWithLeaseIfIncludes':
				return l10n.t(
					'Unable to force push because some refs failed to push or the push was rejected. The tip of the remote-tracking branch has been updated since the last checkout. Try pulling first.',
				);
			case 'remoteAhead':
				return l10n.t(
					'Unable to push because the remote contains work that you do not have locally. Try fetching first.',
				);
			case 'remoteConnectionFailed':
				return l10n.t('Unable to push because the remote repository could not be reached.');
			case 'tipBehind':
				return l10n.t('Unable to push as it is behind its remote counterpart. Try pulling first.');
			default:
				return l10n.t('Unable to push');
		}
	}
}

export type RebaseErrorReason =
	| 'aborted'
	| 'alreadyInProgress'
	| 'conflicts'
	| 'uncommittedChanges'
	| 'wouldOverwriteChanges'
	| 'other';
interface RebaseErrorDetails {
	reason?: RebaseErrorReason;
	upstream?: string;
	gitCommand?: GitCommandContext;
}

export class RebaseError extends GitCommandError<RebaseErrorDetails> {
	static override is(ex: unknown): ex is RebaseError;
	static override is<R extends RebaseErrorReason>(
		ex: unknown,
		reason: R,
	): ex is RebaseError & { details: { reason: R } };
	static override is(ex: unknown, reason?: RebaseErrorReason): boolean {
		return ex instanceof RebaseError && (reason == null || ex.details.reason === reason);
	}

	protected override buildErrorMessage(details: RebaseErrorDetails, l10n: Translator): string {
		if (details.upstream) {
			switch (details.reason) {
				case 'aborted':
					return l10n.t("Rebase onto '{0}' was aborted", details.upstream);
				case 'alreadyInProgress':
					return l10n.t(
						"Unable to rebase onto '{0}' because a rebase is already in progress",
						details.upstream,
					);
				case 'conflicts':
					return l10n.t(
						"Unable to rebase onto '{0}' due to conflicts. Resolve the conflicts first and continue the rebase",
						details.upstream,
					);
				case 'uncommittedChanges':
					return l10n.t(
						"Unable to rebase onto '{0}' because there are uncommitted changes",
						details.upstream,
					);
				case 'wouldOverwriteChanges':
					return l10n.t(
						"Unable to rebase onto '{0}' because some local changes would be overwritten",
						details.upstream,
					);
				default:
					return l10n.t("Unable to rebase onto '{0}'", details.upstream);
			}
		}

		switch (details.reason) {
			case 'aborted':
				return l10n.t('Rebase was aborted');
			case 'alreadyInProgress':
				return l10n.t('Unable to rebase because a rebase is already in progress');
			case 'conflicts':
				return l10n.t('Unable to rebase due to conflicts. Resolve the conflicts first and continue the rebase');
			case 'uncommittedChanges':
				return l10n.t('Unable to rebase because there are uncommitted changes');
			case 'wouldOverwriteChanges':
				return l10n.t('Unable to rebase because some local changes would be overwritten');
			default:
				return l10n.t('Unable to rebase');
		}
	}
}

export type ResetErrorReason =
	| 'ambiguousArgument'
	| 'notUpToDate'
	| 'detachedHead'
	| 'permissionDenied'
	| 'refLocked'
	| 'unmergedChanges'
	| 'wouldOverwriteChanges'
	| 'other';
interface ResetErrorDetails {
	reason?: ResetErrorReason;
	gitCommand?: GitCommandContext;
}

export class ResetError extends GitCommandError<ResetErrorDetails> {
	static override is(ex: unknown): ex is ResetError;
	static override is<R extends ResetErrorReason>(
		ex: unknown,
		reason: R,
	): ex is ResetError & { details: { reason: R } };
	static override is(ex: unknown, reason?: ResetErrorReason): boolean {
		return ex instanceof ResetError && (reason == null || ex.details.reason === reason);
	}

	protected override buildErrorMessage(details: ResetErrorDetails, l10n: Translator): string {
		switch (details.reason) {
			case 'ambiguousArgument':
				return l10n.t('Unable to reset because the argument is ambiguous');
			case 'detachedHead':
				return l10n.t('Unable to reset because you are in a detached HEAD state');
			case 'notUpToDate':
				return l10n.t(
					'Unable to reset because the index is not up to date (you may have unresolved merge conflicts)',
				);
			case 'permissionDenied':
				return l10n.t("Unable to reset because you don't have permission to modify affected files");
			case 'refLocked':
				return l10n.t('Unable to reset because the ref is locked');
			case 'unmergedChanges':
				return l10n.t('Unable to reset because there are unmerged changes');
			case 'wouldOverwriteChanges':
				return l10n.t('Unable to reset because your local changes would be overwritten');
			default:
				return l10n.t('Unable to reset');
		}
	}
}

export type RevertErrorReason =
	| 'aborted'
	| 'alreadyInProgress'
	| 'conflicts'
	| 'uncommittedChanges'
	| 'wouldOverwriteChanges'
	| 'other';
interface RevertErrorDetails {
	reason?: RevertErrorReason;
	refs?: string[];
	gitCommand?: GitCommandContext;
}

export class RevertError extends GitCommandError<RevertErrorDetails> {
	static override is(ex: unknown): ex is RevertError;
	static override is<R extends RevertErrorReason>(
		ex: unknown,
		reason: R,
	): ex is RevertError & { details: { reason: R } };
	static override is(ex: unknown, reason?: RevertErrorReason): boolean {
		return ex instanceof RevertError && (reason == null || ex.details.reason === reason);
	}

	protected override buildErrorMessage(details: RevertErrorDetails, l10n: Translator): string {
		if (details.refs?.length) {
			const refs = details.refs.join(', ');
			switch (details.reason) {
				case 'aborted':
					return l10n.t('Revert of {0} was aborted', refs);
				case 'alreadyInProgress':
					return l10n.t('Unable to revert {0} because a revert is already in progress', refs);
				case 'conflicts':
					return l10n.t(
						'Unable to revert {0} due to conflicts. Resolve the conflicts first and continue the revert',
						refs,
					);
				case 'uncommittedChanges':
					return l10n.t('Unable to revert {0} because there are uncommitted changes', refs);
				case 'wouldOverwriteChanges':
					return l10n.t('Unable to revert {0} because some local changes would be overwritten', refs);
				default:
					return l10n.t('Unable to revert {0}', refs);
			}
		}

		switch (details.reason) {
			case 'aborted':
				return l10n.t('Revert was aborted');
			case 'alreadyInProgress':
				return l10n.t('Unable to revert because a revert is already in progress');
			case 'conflicts':
				return l10n.t('Unable to revert due to conflicts. Resolve the conflicts first and continue the revert');
			case 'uncommittedChanges':
				return l10n.t('Unable to revert because there are uncommitted changes');
			case 'wouldOverwriteChanges':
				return l10n.t('Unable to revert because some local changes would be overwritten');
			default:
				return l10n.t('Unable to revert');
		}
	}
}

export type StashApplyErrorReason = 'uncommittedChanges' | 'other';
interface StashApplyErrorDetails {
	reason?: StashApplyErrorReason;
	gitCommand?: GitCommandContext;
}

export class StashApplyError extends GitCommandError<StashApplyErrorDetails> {
	static override is(ex: unknown): ex is StashApplyError;
	static override is<R extends StashApplyErrorReason>(
		ex: unknown,
		reason: R,
	): ex is StashApplyError & { details: { reason: R } };
	static override is(ex: unknown, reason?: StashApplyErrorReason): boolean {
		return ex instanceof StashApplyError && (reason == null || ex.details.reason === reason);
	}

	protected override buildErrorMessage(details: StashApplyErrorDetails, l10n: Translator): string {
		switch (details.reason) {
			case 'uncommittedChanges':
				return l10n.t(
					'Unable to apply stash. Your working tree changes would be overwritten. Please commit or stash your changes before trying again',
				);
			default:
				return l10n.t('Unable to apply stash');
		}
	}
}

export type StashPushErrorReason = 'conflictingStagedAndUnstagedLines' | 'nothingToSave' | 'other';
interface StashPushErrorDetails {
	reason?: StashPushErrorReason;
	gitCommand?: GitCommandContext;
}

export class StashPushError extends GitCommandError<StashPushErrorDetails> {
	static override is(ex: unknown): ex is StashPushError;
	static override is<R extends StashPushErrorReason>(
		ex: unknown,
		reason: R,
	): ex is StashPushError & { details: { reason: R } };
	static override is(ex: unknown, reason?: StashPushErrorReason): boolean {
		return ex instanceof StashPushError && (reason == null || ex.details.reason === reason);
	}

	protected override buildErrorMessage(details: StashPushErrorDetails, l10n: Translator): string {
		switch (details.reason) {
			case 'conflictingStagedAndUnstagedLines':
				return l10n.t(
					'Changes were stashed, but the working tree cannot be updated because at least one file has staged and unstaged changes on the same line(s)',
				);
			case 'nothingToSave':
				return l10n.t('No files to stash');
			default:
				return l10n.t('Unable to stash');
		}
	}
}

export type ShowErrorReason = 'invalidObject' | 'invalidRevision' | 'notFound' | 'notInRevision' | 'other';
interface ShowErrorDetails {
	reason?: ShowErrorReason;
	rev?: string;
	path?: string;
	gitCommand?: GitCommandContext;
}

export class ShowError extends GitCommandError<ShowErrorDetails> {
	static override is(ex: unknown): ex is ShowError;
	static override is<R extends ShowErrorReason>(ex: unknown, reason: R): ex is ShowError & { details: { reason: R } };
	static override is(ex: unknown, reason?: ShowErrorReason): boolean {
		return ex instanceof ShowError && (reason == null || ex.details.reason === reason);
	}

	protected override buildErrorMessage(details: ShowErrorDetails, l10n: Translator): string {
		if (details.path && details.rev) {
			switch (details.reason) {
				case 'invalidObject':
					return l10n.t(
						"Unable to show '{0}' at revision '{1}' because the path is not a file",
						details.path,
						details.rev,
					);
				case 'invalidRevision':
					return l10n.t(
						"Unable to show '{0}' at revision '{1}' because the specified revision is invalid",
						details.path,
						details.rev,
					);
				case 'notFound':
					return l10n.t(
						"Unable to show '{0}' at revision '{1}' because the file does not exist",
						details.path,
						details.rev,
					);
				case 'notInRevision':
					return l10n.t(
						"Unable to show '{0}' at revision '{1}' because the file is not in the specified revision",
						details.path,
						details.rev,
					);
				default:
					return l10n.t("Unable to show '{0}' at revision '{1}'", details.path, details.rev);
			}
		}

		if (details.path) {
			switch (details.reason) {
				case 'invalidObject':
					return l10n.t("Unable to show '{0}' because the path is not a file", details.path);
				case 'invalidRevision':
					return l10n.t("Unable to show '{0}' because the specified revision is invalid", details.path);
				case 'notFound':
					return l10n.t("Unable to show '{0}' because the file does not exist", details.path);
				case 'notInRevision':
					return l10n.t(
						"Unable to show '{0}' because the file is not in the specified revision",
						details.path,
					);
				default:
					return l10n.t("Unable to show '{0}'", details.path);
			}
		}

		if (details.rev) {
			switch (details.reason) {
				case 'invalidObject':
					return l10n.t("Unable to show file at revision '{0}' because the path is not a file", details.rev);
				case 'invalidRevision':
					return l10n.t(
						"Unable to show file at revision '{0}' because the specified revision is invalid",
						details.rev,
					);
				case 'notFound':
					return l10n.t("Unable to show file at revision '{0}' because the file does not exist", details.rev);
				case 'notInRevision':
					return l10n.t(
						"Unable to show file at revision '{0}' because the file is not in the specified revision",
						details.rev,
					);
				default:
					return l10n.t("Unable to show file at revision '{0}'", details.rev);
			}
		}

		switch (details.reason) {
			case 'invalidObject':
				return l10n.t('Unable to show file because the path is not a file');
			case 'invalidRevision':
				return l10n.t('Unable to show file because the specified revision is invalid');
			case 'notFound':
				return l10n.t('Unable to show file because the file does not exist');
			case 'notInRevision':
				return l10n.t('Unable to show file because the file is not in the specified revision');
			default:
				return l10n.t('Unable to show file');
		}
	}
}

export type TagErrorReason =
	| 'alreadyExists'
	| 'invalidName'
	| 'notFound'
	| 'permissionDenied'
	| 'remoteRejected'
	| 'tagConflict'
	| 'other';
type KnownTagErrorAction = 'create' | 'delete' | 'push';
interface TagErrorDetails {
	reason?: TagErrorReason;
	action?: KnownTagErrorAction;
	tag?: string;
	gitCommand?: GitCommandContext;
}

export class TagError extends GitCommandError<TagErrorDetails> {
	static override is(ex: unknown): ex is TagError;
	static override is<R extends TagErrorReason>(ex: unknown, reason: R): ex is TagError & { details: { reason: R } };
	static override is(ex: unknown, reason?: TagErrorReason): boolean {
		return ex instanceof TagError && (reason == null || ex.details.reason === reason);
	}

	protected override buildErrorMessage(details: TagErrorDetails, l10n: Translator): string {
		const tag = details.tag;
		const action = details.action;
		if (!tag) {
			return getMissingTagErrorMessage(action, details.reason, l10n);
		}

		switch (action) {
			case 'create':
				switch (details.reason) {
					case 'alreadyExists':
						return l10n.t("Unable to create tag '{0}' because it already exists", tag);
					case 'invalidName':
						return l10n.t("Unable to create tag '{0}' because the tag name is invalid", tag);
					case 'notFound':
						return l10n.t("Unable to create tag '{0}' because it does not exist", tag);
					case 'permissionDenied':
						return l10n.t(
							"Unable to create tag '{0}' because you don't have permission to push to this remote repository.",
							tag,
						);
					case 'remoteRejected':
						return l10n.t(
							"Unable to create tag '{0}' because the remote repository rejected the push.",
							tag,
						);
					case 'tagConflict':
						return l10n.t(
							"Unable to create tag '{0}' because the remote already has a tag with that name. Use force to overwrite it.",
							tag,
						);
					default:
						return l10n.t("Unable to create tag '{0}'", tag);
				}
			case 'delete':
				switch (details.reason) {
					case 'alreadyExists':
						return l10n.t("Unable to delete tag '{0}' because it already exists", tag);
					case 'invalidName':
						return l10n.t("Unable to delete tag '{0}' because the tag name is invalid", tag);
					case 'notFound':
						return l10n.t("Unable to delete tag '{0}' because it does not exist", tag);
					case 'permissionDenied':
						return l10n.t(
							"Unable to delete tag '{0}' because you don't have permission to push to this remote repository.",
							tag,
						);
					case 'remoteRejected':
						return l10n.t(
							"Unable to delete tag '{0}' because the remote repository rejected the push.",
							tag,
						);
					case 'tagConflict':
						return l10n.t(
							"Unable to delete tag '{0}' because the remote already has a tag with that name. Use force to overwrite it.",
							tag,
						);
					default:
						return l10n.t("Unable to delete tag '{0}'", tag);
				}
			case 'push':
				switch (details.reason) {
					case 'alreadyExists':
						return l10n.t("Unable to push tag '{0}' because it already exists", tag);
					case 'invalidName':
						return l10n.t("Unable to push tag '{0}' because the tag name is invalid", tag);
					case 'notFound':
						return l10n.t("Unable to push tag '{0}' because it does not exist", tag);
					case 'permissionDenied':
						return l10n.t(
							"Unable to push tag '{0}' because you don't have permission to push to this remote repository.",
							tag,
						);
					case 'remoteRejected':
						return l10n.t("Unable to push tag '{0}' because the remote repository rejected the push.", tag);
					case 'tagConflict':
						return l10n.t(
							"Unable to push tag '{0}' because the remote already has a tag with that name. Use force to overwrite it.",
							tag,
						);
					default:
						return l10n.t("Unable to push tag '{0}'", tag);
				}
			default:
				return getGenericTagErrorMessage(tag, details.reason, l10n);
		}
	}
}

function getMissingTagErrorMessage(
	action: KnownTagErrorAction | undefined,
	reason: TagErrorReason | undefined,
	l10n: Translator,
): string {
	switch (action) {
		case 'create':
			switch (reason) {
				case 'alreadyExists':
					return l10n.t('Unable to create tag because it already exists');
				case 'invalidName':
					return l10n.t('Unable to create tag because the tag name is invalid');
				case 'notFound':
					return l10n.t('Unable to create tag because it does not exist');
				case 'permissionDenied':
					return l10n.t(
						"Unable to create tag because you don't have permission to push to this remote repository.",
					);
				case 'remoteRejected':
					return l10n.t('Unable to create tag because the remote repository rejected the push.');
				case 'tagConflict':
					return l10n.t(
						'Unable to create tag because the remote already has a tag with that name. Use force to overwrite it.',
					);
				default:
					return l10n.t('Unable to create tag');
			}
		case 'delete':
			switch (reason) {
				case 'alreadyExists':
					return l10n.t('Unable to delete tag because it already exists');
				case 'invalidName':
					return l10n.t('Unable to delete tag because the tag name is invalid');
				case 'notFound':
					return l10n.t('Unable to delete tag because it does not exist');
				case 'permissionDenied':
					return l10n.t(
						"Unable to delete tag because you don't have permission to push to this remote repository.",
					);
				case 'remoteRejected':
					return l10n.t('Unable to delete tag because the remote repository rejected the push.');
				case 'tagConflict':
					return l10n.t(
						'Unable to delete tag because the remote already has a tag with that name. Use force to overwrite it.',
					);
				default:
					return l10n.t('Unable to delete tag');
			}
		case 'push':
			switch (reason) {
				case 'alreadyExists':
					return l10n.t('Unable to push tag because it already exists');
				case 'invalidName':
					return l10n.t('Unable to push tag because the tag name is invalid');
				case 'notFound':
					return l10n.t('Unable to push tag because it does not exist');
				case 'permissionDenied':
					return l10n.t(
						"Unable to push tag because you don't have permission to push to this remote repository.",
					);
				case 'remoteRejected':
					return l10n.t('Unable to push tag because the remote repository rejected the push.');
				case 'tagConflict':
					return l10n.t(
						'Unable to push tag because the remote already has a tag with that name. Use force to overwrite it.',
					);
				default:
					return l10n.t('Unable to push tag');
			}
		default:
			switch (reason) {
				case 'alreadyExists':
					return l10n.t('Unable to perform action on tag because it already exists');
				case 'invalidName':
					return l10n.t('Unable to perform action on tag because the tag name is invalid');
				case 'notFound':
					return l10n.t('Unable to perform action on tag because it does not exist');
				case 'permissionDenied':
					return l10n.t(
						"Unable to perform action on tag because you don't have permission to push to this remote repository.",
					);
				case 'remoteRejected':
					return l10n.t('Unable to perform action on tag because the remote repository rejected the push.');
				case 'tagConflict':
					return l10n.t(
						'Unable to perform action on tag because the remote already has a tag with that name. Use force to overwrite it.',
					);
				default:
					return l10n.t('Unable to perform action on tag');
			}
	}
}

function getGenericTagErrorMessage(tag: string, reason: TagErrorReason | undefined, l10n: Translator): string {
	switch (reason) {
		case 'alreadyExists':
			return l10n.t("Unable to perform action with tag '{0}' because it already exists", tag);
		case 'invalidName':
			return l10n.t("Unable to perform action with tag '{0}' because the tag name is invalid", tag);
		case 'notFound':
			return l10n.t("Unable to perform action with tag '{0}' because it does not exist", tag);
		case 'permissionDenied':
			return l10n.t(
				"Unable to perform action with tag '{0}' because you don't have permission to push to this remote repository.",
				tag,
			);
		case 'remoteRejected':
			return l10n.t(
				"Unable to perform action with tag '{0}' because the remote repository rejected the push.",
				tag,
			);
		case 'tagConflict':
			return l10n.t(
				"Unable to perform action with tag '{0}' because the remote already has a tag with that name. Use force to overwrite it.",
				tag,
			);
		default:
			return l10n.t("Unable to perform action with tag '{0}'", tag);
	}
}

export class WorkspaceUntrustedError extends Error {
	static is(ex: unknown): ex is WorkspaceUntrustedError {
		return ex instanceof WorkspaceUntrustedError;
	}

	constructor() {
		super(l10n.t('Unable to perform Git operations because the current workspace is untrusted'));

		Error.captureStackTrace?.(this, new.target);
	}
}

export type WorktreeCreateErrorReason = 'alreadyCheckedOut' | 'alreadyExists';
interface WorktreeCreateErrorDetails {
	reason?: WorktreeCreateErrorReason;
	gitCommand?: GitCommandContext;
}

export class WorktreeCreateError extends GitCommandError<WorktreeCreateErrorDetails> {
	static override is(ex: unknown): ex is WorktreeCreateError;
	static override is<R extends WorktreeCreateErrorReason>(
		ex: unknown,
		reason: R,
	): ex is WorktreeCreateError & { details: { reason: R } };
	static override is(ex: unknown, reason?: WorktreeCreateErrorReason): boolean {
		return ex instanceof WorktreeCreateError && (reason == null || ex.details.reason === reason);
	}

	protected override buildErrorMessage(details: WorktreeCreateErrorDetails, l10n: Translator): string {
		switch (details.reason) {
			case 'alreadyCheckedOut':
				return l10n.t('Unable to create worktree because it is already checked out');
			case 'alreadyExists':
				return l10n.t('Unable to create worktree because it already exists');
			default:
				return l10n.t('Unable to create worktree');
		}
	}
}

export type WorktreeDeleteErrorReason = 'defaultWorkingTree' | 'directoryNotEmpty' | 'locked' | 'uncommittedChanges';
interface WorktreeDeleteErrorDetails {
	reason?: WorktreeDeleteErrorReason;
	/** The reason the worktree was locked, when known and provided by the locker */
	lockReason?: string;
	gitCommand?: GitCommandContext;
}

export class WorktreeDeleteError extends GitCommandError<WorktreeDeleteErrorDetails> {
	static override is(ex: unknown): ex is WorktreeDeleteError;
	static override is<R extends WorktreeDeleteErrorReason>(
		ex: unknown,
		reason: R,
	): ex is WorktreeDeleteError & { details: { reason: R } };
	static override is(ex: unknown, reason?: WorktreeDeleteErrorReason): boolean {
		return ex instanceof WorktreeDeleteError && (reason == null || ex.details.reason === reason);
	}

	protected override buildErrorMessage(details: WorktreeDeleteErrorDetails, l10n: Translator): string {
		switch (details.reason) {
			case 'defaultWorkingTree':
				return l10n.t('Cannot delete worktree because it is the default working tree');
			case 'directoryNotEmpty':
				return l10n.t('Unable to delete worktree because the directory is not empty');
			case 'locked':
				return l10n.t('Unable to delete worktree because it is locked');
			case 'uncommittedChanges':
				return l10n.t('Unable to delete worktree because there are uncommitted changes');
			default:
				return l10n.t('Unable to delete worktree');
		}
	}
}

/**
 * Token info accepted by {@link AuthenticationError}.
 * Structurally compatible with both the extension's `TokenInfo` / `TokenWithInfo`
 * and the package's `GitHubTokenInfo`.
 */
export interface AuthTokenInfo {
	readonly providerId: string;
	readonly microHash?: string;
	readonly cloud: boolean;
	readonly type: string | undefined;
	readonly scopes?: readonly string[];
	readonly expiresAt?: Date;
}

export const enum AuthenticationErrorReason {
	UserDidNotConsent = 1,
	Unauthorized = 2,
	Forbidden = 3,
}

export class AuthenticationError extends Error {
	readonly id: string;
	readonly original?: Error;
	readonly reason: AuthenticationErrorReason | undefined;
	readonly authInfo: string;

	constructor(info: AuthTokenInfo, reason?: AuthenticationErrorReason, original?: Error);
	constructor(info: AuthTokenInfo, message?: string, original?: Error);
	constructor(
		info: AuthTokenInfo,
		messageOrReason: string | AuthenticationErrorReason | undefined,
		original?: Error,
	) {
		const { providerId: id, type, cloud, scopes, expiresAt } = info;
		const tokenDetails = [
			cloud ? 'cloud' : 'self-managed',
			type,
			info.microHash,
			expiresAt && `expiresAt=${isNaN(expiresAt.getTime()) ? expiresAt.toString() : expiresAt.toISOString()}`,
			scopes && `[${scopes.join(',')}]`,
		]
			.filter(v => v)
			.join(', ');
		const authInfo = `(token details: ${tokenDetails})`;
		let message;
		let reason: AuthenticationErrorReason | undefined;
		if (messageOrReason == null) {
			message = l10n.t("Unable to get required authentication session for '{0}'", id);
		} else if (typeof messageOrReason === 'string') {
			message = messageOrReason;
			reason = undefined;
		} else {
			reason = messageOrReason;
			switch (reason) {
				case AuthenticationErrorReason.UserDidNotConsent:
					message = l10n.t("'{0}' authentication is required for this operation", id);
					break;
				case AuthenticationErrorReason.Unauthorized:
					message = l10n.t("Your '{0}' credentials are either invalid or expired", id);
					break;
				case AuthenticationErrorReason.Forbidden:
					message = l10n.t("Your '{0}' credentials do not have the required access", id);
					break;
			}
		}
		super(message);

		this.id = id;
		this.original = original;
		this.reason = reason;
		this.authInfo = authInfo;
		Error.captureStackTrace?.(this, new.target);
	}

	static is(ex: unknown): ex is AuthenticationError {
		return ex instanceof AuthenticationError;
	}

	override toString(): string {
		return `${super.toString()} ${this.authInfo}`;
	}
}

export class RequestClientError extends Error {
	static is(ex: unknown): ex is RequestClientError {
		return ex instanceof RequestClientError;
	}

	constructor(public readonly original: Error) {
		super(original.message);

		Error.captureStackTrace?.(this, new.target);
	}
}

export class RequestNotFoundError extends Error {
	static is(ex: unknown): ex is RequestNotFoundError {
		return ex instanceof RequestNotFoundError;
	}

	constructor(public readonly original: Error) {
		super(original.message);

		Error.captureStackTrace?.(this, new.target);
	}
}

export class RequestRateLimitError extends Error {
	static is(ex: unknown): ex is RequestRateLimitError {
		return ex instanceof RequestRateLimitError;
	}

	constructor(
		public readonly original: Error,
		public readonly token: string | undefined,
		public readonly resetAt: number | undefined,
	) {
		super(original.message);

		Error.captureStackTrace?.(this, new.target);
	}
}

export type SigningErrorReason = 'noKey' | 'gpgNotFound' | 'sshNotFound' | 'passphraseFailed' | 'unknown';

interface SigningErrorDetails {
	reason?: SigningErrorReason;
	gitCommand?: GitCommandContext;
}

export class SigningError extends GitCommandError<SigningErrorDetails> {
	static override is(ex: unknown): ex is SigningError;
	static override is<R extends SigningErrorReason>(
		ex: unknown,
		reason: R,
	): ex is SigningError & { details: { reason: R } };
	static override is(ex: unknown, reason?: SigningErrorReason): boolean {
		return ex instanceof SigningError && (reason == null || ex.details.reason === reason);
	}

	protected override buildErrorMessage(details: SigningErrorDetails, l10n: Translator): string {
		switch (details.reason) {
			case 'noKey':
				return l10n.t('Unable to sign commit because no signing key is configured');
			case 'gpgNotFound':
				return l10n.t('Unable to sign commit because GPG program was not found');
			case 'sshNotFound':
				return l10n.t('Unable to sign commit because SSH program was not found');
			case 'passphraseFailed':
				return l10n.t('Unable to sign commit because GPG passphrase failed or was cancelled');
			default:
				return l10n.t('Unable to sign commit');
		}
	}
}
