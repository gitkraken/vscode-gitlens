import { Uri } from 'vscode';
import type { GitCommitStats } from '@gitlens/git/models/commit.js';
import { GitCommit } from '@gitlens/git/models/commit.js';
import type { GitFile } from '@gitlens/git/models/file.js';
import type { GitFileChange } from '@gitlens/git/models/fileChange.js';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import { uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
import type { CommitSignature } from '@gitlens/git/models/signature.js';
import type { PreviousRangeComparisonUrisResult } from '@gitlens/git/providers/diff.js';
import type { DiffRange } from '@gitlens/git/providers/types.js';
import {
	formatCurrentUserDisplayName as _formatCurrentUserDisplayName,
	formatIdentityDisplayName as _formatIdentityDisplayName,
	getChangedFilesCount,
} from '@gitlens/git/utils/commit.utils.js';
import { isUncommitted } from '@gitlens/git/utils/revision.utils.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { EnrichedAutolink } from '../../../autolinks/models/autolinks.js';
import { getAvatarUri, getCachedAvatarUri } from '../../../avatars.js';
import type { CurrentUserNameStyle, GravatarDefaultStyle } from '../../../config.js';
import { GlyphChars } from '../../../constants.js';
import { Container } from '../../../container.js';
import { configuration } from '../../../system/-webview/configuration.js';
import { GitUri } from '../../gitUri.js';
import type { GlRepository } from '../../models/repository.js';
import { getBestRemoteWithIntegration, getRemoteIntegration, remoteSupportsIntegration } from './remote.utils.js';

// #region Current user display name

export function formatCurrentUserDisplayName(name: string, style?: CurrentUserNameStyle): string {
	return _formatCurrentUserDisplayName(name, style ?? configuration.get('defaultCurrentUserNameStyle'));
}

export function formatIdentityDisplayName(
	identity: { name: string; current?: boolean | undefined },
	style?: CurrentUserNameStyle,
): string {
	return _formatIdentityDisplayName(identity, style ?? configuration.get('defaultCurrentUserNameStyle'));
}

// #endregion

// #region Date / formatting utilities

/**
 * Gets the commit date based on the current date source preference (authored or committed).
 */
export function getCommitDate(commit: GitCommit): Date {
	return Container.instance.CommitDateFormatting.dateSource === 'committed'
		? commit.committer.date
		: commit.author.date;
}

/**
 * Gets the commit date formatted according to the current formatting preferences.
 */
export function getCommitFormattedDate(commit: GitCommit): string {
	const { dateSource, dateStyle, dateFormat } = Container.instance.CommitDateFormatting;
	if (dateStyle === 'absolute') {
		return dateSource === 'committed'
			? commit.committer.formatDate(dateFormat)
			: commit.author.formatDate(dateFormat);
	}
	return dateSource === 'committed' ? commit.committer.fromNow() : commit.author.fromNow();
}

/**
 * Formats the commit date using an explicit format string.
 * Respects the current date source preference.
 */
export function formatCommitDate(commit: GitCommit, format?: string | null): string {
	return Container.instance.CommitDateFormatting.dateSource === 'committed'
		? commit.committer.formatDate(format)
		: commit.author.formatDate(format);
}

/**
 * Formats the commit date as a relative "from now" string.
 * Respects the current date source preference.
 */
export function formatCommitDateFromNow(commit: GitCommit, short?: boolean): string {
	return Container.instance.CommitDateFormatting.dateSource === 'committed'
		? commit.committer.fromNow(short)
		: commit.author.fromNow(short);
}

// #endregion

// #region Signature utilities

export async function getCommitSignature(repoPath: string, sha: string): Promise<CommitSignature | undefined> {
	if (isUncommitted(sha)) return undefined;

	return Container.instance.git.getRepositoryService(repoPath).commits.getCommitSignature?.(sha);
}

export async function isCommitSigned(repoPath: string, sha: string): Promise<boolean> {
	if (isUncommitted(sha)) return false;

	return (await Container.instance.git.getRepositoryService(repoPath).commits.isCommitSigned?.(sha)) ?? false;
}

// #endregion

// #region GlRepository utilities

export function getCommitRepository(repoPath: string): GlRepository | undefined {
	return Container.instance.git.getRepository(repoPath);
}

export function isCommitPushed(repoPath: string, ref: string): Promise<boolean> {
	return Container.instance.git.getRepositoryService(repoPath).commits.hasCommitBeenPushed(ref);
}

// #endregion

// #region Pull request / autolinks

export async function getCommitAssociatedPullRequest(
	repoPath: string,
	sha: string,
	remote?: GitRemote,
	options?: { expiryOverride?: boolean | number },
): Promise<PullRequest | undefined> {
	if (isUncommitted(sha)) return undefined;

	remote ??= await getBestRemoteWithIntegration(repoPath);
	if (!(remote != null && remoteSupportsIntegration(remote))) return undefined;

	const integration = await getRemoteIntegration(remote);
	return integration?.getPullRequestForCommit(remote.provider.repoDesc, sha, options);
}

export async function getCommitEnrichedAutolinks(
	repoPath: string,
	message: string | undefined,
	summary: string,
	remote?: GitRemote,
): Promise<Map<string, EnrichedAutolink> | undefined> {
	remote ??= await getBestRemoteWithIntegration(repoPath);

	return Container.instance.autolinks.getEnrichedAutolinks(message ?? summary, remote);
}

// #endregion

// #region Avatar utilities

export function getCommitAuthorAvatarUri(
	commit: GitCommit,
	options?: { defaultStyle?: GravatarDefaultStyle; size?: number },
): Uri | Promise<Uri> {
	if (commit.author.avatarUrl != null) return Uri.parse(commit.author.avatarUrl);
	return getAvatarUri(commit.author.email, commit, options);
}

export function getCommitAuthorCachedAvatarUri(commit: GitCommit, options?: { size?: number }): Uri | undefined {
	if (commit.author.avatarUrl != null) return Uri.parse(commit.author.avatarUrl);
	return getCachedAvatarUri(commit.author.email, options);
}

export function getCommitCommitterAvatarUri(
	commit: GitCommit,
	options?: { defaultStyle?: GravatarDefaultStyle; size?: number },
): Uri | Promise<Uri> {
	if (commit.committer.avatarUrl != null) return Uri.parse(commit.committer.avatarUrl);
	return getAvatarUri(commit.committer.email, commit, options);
}

// #endregion

// #region Stats formatting

export function formatCommitStats(
	stats: GitCommitStats | undefined,
	style: 'short' | 'stats' | 'expanded',
	options?: {
		addParenthesesToFileStats?: boolean;
		color?: boolean;
		empty?: string;
		separator?: string;
	},
): string {
	if (stats == null) return options?.empty ?? '';

	const { files: changedFiles, additions, deletions } = stats;
	if (getChangedFilesCount(changedFiles) <= 0 && additions <= 0 && deletions <= 0) return options?.empty ?? '';

	const separator = options?.separator ?? ' ';

	function formatStat(type: 'added' | 'changed' | 'deleted', value: number) {
		if (style === 'expanded') {
			return `${pluralize('file', value)} ${type}`;
		}

		const label = `${type === 'added' ? '+' : type === 'deleted' ? '-' : '~'}${value}`;
		return style === 'stats' && options?.color
			? /*html*/ `<span style="color:${
					type === 'added'
						? 'var(--vscode-gitDecoration-addedResourceForeground)'
						: type === 'deleted'
							? 'var(--vscode-gitDecoration-deletedResourceForeground)'
							: 'var(--vscode-gitDecoration-modifiedResourceForeground)'
				};">${label}</span>`
			: label;
	}

	const fileStats = [];

	if (typeof changedFiles === 'number') {
		if (changedFiles) {
			fileStats.push(formatStat('changed', changedFiles));
		}
	} else {
		const { added, changed, deleted } = changedFiles;
		if (added) {
			fileStats.push(formatStat('added', added));
		} else if (style === 'stats') {
			fileStats.push(formatStat('added', 0));
		}

		if (changed) {
			fileStats.push(formatStat('changed', changed));
		} else if (style === 'stats') {
			fileStats.push(formatStat('changed', 0));
		}

		if (deleted) {
			fileStats.push(formatStat('deleted', deleted));
		} else if (style === 'stats') {
			fileStats.push(formatStat('deleted', 0));
		}
	}

	let result = fileStats.join(separator);
	if (style === 'stats' && options?.color) {
		result = /*html*/ `<span style="background-color:var(--vscode-textCodeBlock-background);border-radius:3px;">&nbsp;${result}&nbsp;&nbsp;</span> `;
	}
	if (options?.addParenthesesToFileStats) {
		result = `(${result})`;
	}

	if (style === 'expanded') {
		const lineStats = [];

		if (additions) {
			const additionsText = pluralize('addition', additions);
			if (options?.color) {
				lineStats.push(
					/*html*/ `<span style="color:var(--vscode-gitDecoration-addedResourceForeground);">${additionsText}</span>`,
				);
			} else {
				lineStats.push(additionsText);
			}
		}

		if (deletions) {
			const deletionsText = pluralize('deletion', deletions);
			if (options?.color) {
				lineStats.push(
					/*html*/ `<span style="color:var(--vscode-gitDecoration-deletedResourceForeground);">${deletionsText}</span>`,
				);
			} else {
				lineStats.push(deletionsText);
			}
		}

		if (lineStats.length) {
			result += `${
				fileStats.length ? (options?.addParenthesesToFileStats ? `${GlyphChars.Space} ` : `, `) : ''
			}${lineStats.join(separator)}`;
		}
	}

	return result;
}

// #endregion

// #region File / details utilities

export async function findCommitFile(
	commit: GitCommit,
	pathOrUri: string | Uri,
	staged?: boolean,
	options?: { allowFilteredFiles?: boolean; include?: { stats?: boolean } },
): Promise<GitFileChange | undefined> {
	if (!commit.hasFullDetails(options)) {
		await GitCommit.ensureFullDetails(commit, options);
		if (commit.fileset == null) return undefined;
	}

	const relativePath = Container.instance.git.getRelativePath(pathOrUri, commit.repoPath);
	if (commit.isUncommitted && staged != null) {
		return commit.anyFiles?.find(f => f.path === relativePath && f.staged === staged);
	}
	return commit.anyFiles?.find(f => f.path === relativePath);
}

export function getCommitGitUri(commit: GitCommit, previous: boolean = false): GitUri {
	const uri = commit.file?.uri ?? Container.instance.git.getAbsoluteUri(commit.repoPath, commit.repoPath);
	if (!previous) return new GitUri(uri, commit);

	return new GitUri(commit.file?.originalUri ?? uri, {
		repoPath: commit.repoPath,
		sha: commit.unresolvedPreviousSha,
	});
}

export async function getCommitForFile(
	commit: GitCommit,
	file: string | GitFile,
	staged?: boolean,
): Promise<GitCommit | undefined> {
	const path = typeof file === 'string' ? Container.instance.git.getRelativePath(file, commit.repoPath) : file.path;
	const foundFile = await findCommitFile(commit, path, staged);
	if (foundFile == null) return undefined;

	return commit.with({
		sha: foundFile.staged ? uncommittedStaged : commit.sha,
		fileset: { ...commit.fileset!, filtered: { files: [foundFile], pathspec: path } },
	});
}

/**
 * Resolves a path + ref pair into a `(commit, file)` tuple. If `ref` is nullish or the uncommitted sentinel,
 * the lookup targets the uncommitted commit for the repo; otherwise the specified ref. Returns `[]` if the
 * commit cannot be resolved or the file is missing from it.
 */
export async function getCommitAndFileByPath(
	repoPath: string,
	path: string,
	ref: string | undefined,
	staged: boolean | undefined,
): Promise<[commit: GitCommit, file: GitFileChange] | [commit?: undefined, file?: undefined]> {
	const svc = Container.instance.git.getRepositoryService(repoPath);
	const sha = ref != null && ref !== uncommitted ? ref : uncommitted;
	const commit = await svc.commits.getCommit(sha);
	if (commit == null) return [];

	const matched = await getCommitForFile(commit, path, staged);
	return matched != null ? [matched, matched.file!] : [];
}

export async function getCommitsForFiles(
	commit: GitCommit,
	options?: {
		allowFilteredFiles?: boolean;
		include?: { stats?: boolean };
	},
): Promise<GitCommit[]> {
	if (!commit.hasFullDetails(options)) {
		await GitCommit.ensureFullDetails(commit, options);
		if (commit.fileset == null) return [];
	}

	// If we are "allowing" filtered files, prioritize them (allowing here really means "use" filtered files if they exist)
	const commits = (
		options?.allowFilteredFiles
			? (commit.fileset?.filtered?.files ?? commit.fileset?.files)
			: (commit.fileset?.files ?? commit.fileset?.filtered?.files)
	)?.map(f => commit.with({ fileset: { ...commit.fileset!, filtered: { files: [f], pathspec: f.path } } }));
	return commits ?? [];
}

export function getCommitPreviousComparisonUrisForRange(
	commit: GitCommit,
	range: DiffRange,
	rev?: string,
): Promise<PreviousRangeComparisonUrisResult | undefined> {
	if (commit.file == null) return Promise.resolve(undefined);

	const svc = Container.instance.git.getRepositoryService(commit.repoPath);
	return svc.diff.getPreviousComparisonUrisForRange(
		commit.file.uri,
		rev ?? (commit.sha === uncommitted ? undefined : commit.sha),
		range,
	);
}

// #endregion
