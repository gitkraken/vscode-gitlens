import type { Uri } from 'vscode';
import { GitCommit } from '@gitlens/git/models/commit.js';
import type { GitDiffFileStats } from '@gitlens/git/models/diff.js';
import { GitFileChange } from '@gitlens/git/models/fileChange.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import { isUncommitted } from '@gitlens/git/utils/revision.utils.js';
import { uniqueBy } from '@gitlens/utils/iterable.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import { getAvatarUri, getCachedAvatarUri } from '../../avatars.js';
import type { Container } from '../../container.js';
import { CommitFormatter } from '../../git/formatters/commitFormatter.js';
import { findCommitFile, getCommitForFile } from '../../git/utils/-webview/commit.utils.js';
import { isWebviewItemContext } from '../../system/webview.js';
import type {
	CommitDetails,
	DetailsFileContextValue,
	DetailsFolderContextValue,
	DetailsItemContext,
	DetailsItemTypedContext,
	DetailsItemTypedContextValue,
} from './protocol.js';
import { messageHeadlineSplitterToken } from './protocol.js';

export function isDetailsItemContext(item: unknown): item is DetailsItemContext {
	if (item == null) return false;

	return (
		isWebviewItemContext(item) &&
		(item.webview === 'gitlens.views.commitDetails' ||
			// The embedded graph details panel lives inside the graph webview,
			// so VS Code may pass the graph panel/view ID as the webview context
			item.webview === 'gitlens.graph' ||
			item.webview === 'gitlens.views.graph')
	);
}

export function isDetailsItemTypedContext(
	item: unknown,
	type: 'file',
): item is DetailsItemTypedContext<DetailsFileContextValue>;
export function isDetailsItemTypedContext(
	item: unknown,
	type: 'folder',
): item is DetailsItemTypedContext<DetailsFolderContextValue>;
export function isDetailsItemTypedContext(
	item: unknown,
	type: DetailsItemTypedContextValue['type'],
): item is DetailsItemTypedContext {
	if (item == null) return false;

	return (
		isDetailsItemContext(item) && typeof item.webviewItemValue === 'object' && item.webviewItemValue.type === type
	);
}

export function isDetailsFileContext(item: unknown): item is DetailsItemTypedContext<DetailsFileContextValue> {
	if (item == null) return false;

	return isDetailsItemTypedContext(item, 'file');
}

export function isDetailsFolderContext(item: unknown): item is DetailsItemTypedContext<DetailsFolderContextValue> {
	if (item == null) return false;

	return isDetailsItemTypedContext(item, 'folder');
}

export function getUriFromContext(container: Container, context: DetailsFileContextValue): Uri | undefined {
	const { path, repoPath, sha } = context;
	const svc = container.git.getRepositoryService(repoPath);

	let uri: Uri | undefined;
	if (sha != null && !isUncommitted(sha)) {
		uri = svc.getRevisionUri(sha, path);
	} else {
		uri = svc.getAbsoluteUri(path, repoPath);
	}
	return uri;
}

export function getFolderUriFromContext(container: Container, context: DetailsFolderContextValue): Uri {
	return container.git.getAbsoluteUri(context.path, context.repoPath);
}

/**
 * Builds the core commit details payload — identity, message, files, stats — for both the Inspect view
 * and the Graph's details panel. Deliberately awaits ONLY `ensureFullDetails`: the file list must not
 * wait on anything else. Avatars resolve synchronously (never a network fetch) and worktree reachability
 * is omitted entirely; both are upgraded afterwards by the webview's deferred enrichment fan-out
 * (`fetchCommitEnrichment`).
 *
 * `knownAvatars` is the Graph's already-resolved email→URL map. Without it the Graph's core payload would
 * fall back to gravatar for faces its own rows already show — the rows resolve avatars at size 16 and the
 * details at size 32, and the avatar cache is keyed by size, so a warm row does NOT warm this lookup.
 */
export async function getCoreCommitDetails(
	commit: GitCommit,
	options?: { knownAvatars?: ReadonlyMap<string, string> },
): Promise<CommitDetails> {
	if (!commit.hasFullDetails()) {
		try {
			await GitCommit.ensureFullDetails(commit, { include: { uncommittedFiles: true } });
		} catch {
			// Degrade to a file-less payload rather than failing the whole fetch — the header, message, and
			// stats still render. (The pre-extraction copies got this from `Promise.allSettled`; a bare await
			// would instead blank the panel on a transient `git status`/`git log` failure.)
		}
	}

	// Raw message with headline split — no autolink linkification (that's deferred)
	let message = CommitFormatter.fromTemplate(`\${message}`, commit);
	const index = message.indexOf('\n');
	if (index !== -1) {
		message = `${message.substring(0, index)}${messageHeadlineSplitterToken}${message.substring(index + 1)}`;
	}

	// The working (uncommitted) commit's `anyFiles` carries a separate staged + unstaged entry for
	// each partially-staged ("mixed") file. The details panels show working changes as a single
	// working-tree-vs-HEAD changeset, so collapse to one row per path (keeping the first = unstaged
	// twin). Row-click and right-click both diff HEAD↔working, so the dropped staged distinction is
	// invisible here — this only removes the duplicate row and de-inflates the file counts.
	const changedFiles = commit.isUncommitted
		? [
				...uniqueBy(
					commit.anyFiles ?? [],
					f => f.path,
					original => original,
				),
			]
		: commit.fileset?.files;

	const hasDistinctCommitter = commit.committer.email != null && commit.committer.email !== commit.author.email;
	const knownAvatars = options?.knownAvatars;

	return {
		repoPath: commit.repoPath,
		sha: commit.sha,
		shortSha: commit.shortSha,
		author: { ...commit.author, avatar: resolveCoreAvatar(commit.author, knownAvatars) },
		committer: {
			...commit.committer,
			avatar: hasDistinctCommitter ? resolveCoreAvatar(commit.committer, knownAvatars) : undefined,
		},
		message: message,
		parents: commit.parents,
		stashNumber: commit.refType === 'stash' ? commit.stashNumber : undefined,
		stashOnRef: commit.refType === 'stash' ? commit.stashOnRef : undefined,
		// Serialize files to plain objects - GitFileChange class instances contain
		// a Container reference which causes circular reference errors during JSON serialization
		files: changedFiles?.map(f => ({
			repoPath: f.repoPath,
			path: f.path,
			status: f.status,
			originalPath: f.originalPath,
			staged: f.staged,
			stats: f.stats,
		})),
		// Recompute the file counts from the deduped list so the working-changes header doesn't
		// double-count mixed files. Line totals (`additions`/`deletions`) come from `git diff --stat
		// HEAD` and are already counted once, so they're preserved as-is.
		stats:
			commit.isUncommitted && commit.stats != null
				? { ...commit.stats, files: countFileChanges(changedFiles) }
				: commit.stats,
	};
}

/** Best avatar obtainable with zero async work, in descending order of fidelity: an integration-supplied
 *  URL, an already-resolved avatar at OUR size, the Graph's resolved map (the right face, but resolved at
 *  the rows' smaller size — better than a gravatar, and the deferred avatar leg upgrades it), else the
 *  synchronous cached-or-gravatar lookup (the `undefined` repo overload never fetches). */
function resolveCoreAvatar(
	identity: { email: string | undefined; avatarUrl?: string },
	knownAvatars: ReadonlyMap<string, string> | undefined,
): string | undefined {
	if (identity.avatarUrl != null) return identity.avatarUrl;
	if (!identity.email) return getAvatarUri(identity.email, undefined, { size: 32 }).toString(true);

	const cached = getCachedAvatarUri(identity.email, { size: 32 });
	if (cached != null) return cached.toString(true);

	return knownAvatars?.get(identity.email) ?? getAvatarUri(identity.email, undefined, { size: 32 }).toString(true);
}

/** Tallies added/deleted/changed counts from a file list — mirrors `GitCommit.computeFileStats` so the
 *  deduped working-changes list reports the same buckets, minus the mixed-file double-count. */
function countFileChanges(files: readonly GitFileChange[] | undefined): GitDiffFileStats {
	const counts = { added: 0, deleted: 0, changed: 0 };
	if (files != null) {
		for (const f of files) {
			if (f.status === 'A' || f.status === '?') {
				counts.added++;
			} else if (f.status === 'D') {
				counts.deleted++;
			} else {
				counts.changed++;
			}
		}
	}
	return counts;
}

export type ComparisonContext = { sha: string };

/** A `webviewItemsValues` entry resolved to its commit + file for a multi-file action. */
export interface ResolvedDetailsFile {
	commit: GitCommit;
	file: GitFileChange;
	comparison?: ComparisonContext;
	/** The per-item `webviewItem` string (carries `+staged`/`+unstaged`/`+conflict`), so multi handlers
	 * can act on only the applicable subset (e.g. Stage stages only the `+unstaged` files). */
	webviewItem?: string;
}

export async function getFileCommitFromContext(
	container: Container,
	context: DetailsFileContextValue,
): Promise<
	| [commit: GitCommit, file: GitFileChange, comparison?: ComparisonContext]
	| [commit?: undefined, file?: undefined, comparison?: undefined]
> {
	const { path, repoPath, sha, comparisonSha, staged, stashNumber } = context;
	const svc = container.git.getRepositoryService(repoPath);
	const comparison = comparisonSha != null ? { sha: comparisonSha } : undefined;

	if (stashNumber != null) {
		const stash = await svc.stash?.getStash();
		const commit = stash?.stashes.get(sha!);
		if (commit == null) return [];

		const file = await findCommitFile(commit, path);
		return commit != null && file != null ? [commit, file, comparison] : [];
	}

	if (isUncommitted(sha)) {
		let commit = await svc.commits.getCommit(uncommitted);
		commit = commit != null ? await getCommitForFile(commit, path, staged) : undefined;
		return commit?.file != null ? [commit, commit.file, comparison] : [];
	}

	// For comparison files, the file may not have been changed in the specific "to" commit —
	// it may have changed in an intermediate commit. Use getCommit (no file filtering) and
	// construct the GitFileChange from context data.
	if (comparison != null) {
		const commit = await svc.commits.getCommit(sha!);
		if (commit == null) return [];

		const uri = svc.getRevisionUri(sha!, path);
		const file = new GitFileChange(repoPath, path, context.status ?? 'M', uri);
		return [commit, file, comparison];
	}

	const uri = getUriFromContext(container, context);
	if (uri == null) return [];

	const commit = await svc.commits.getCommitForFile(uri, sha);
	return commit?.file != null ? [commit, commit.file, comparison] : [];
}

/**
 * Resolve a multi-selection right-click to its commit+file set. Reads `webviewItemsValues` (all the
 * selected files, set on the row by gl-file-tree-pane just-in-time) and falls back to the single
 * right-clicked row when absent. Shared by the commit-details and graph webview registrations.
 */
export async function resolveMultiFileContext(container: Container, item: unknown): Promise<ResolvedDetailsFile[]> {
	if (item == null || typeof item !== 'object') return [];

	// The multi context carries `webviewItemsValues` (all selected files) but omits the singular
	// `webviewItem` so single-file menus hide on multi-select; fall back to the single row's value.
	const ctx = item as {
		webviewItem?: string;
		webviewItemsValues?: { webviewItem?: string; webviewItemValue: DetailsFileContextValue }[];
		webviewItemValue?: DetailsFileContextValue;
	};
	const values =
		ctx.webviewItemsValues ??
		(ctx.webviewItemValue != null
			? [{ webviewItem: ctx.webviewItem, webviewItemValue: ctx.webviewItemValue }]
			: []);

	// Resolve all files concurrently — each lookup is independent git IO; serializing would scale
	// latency linearly with the selection size on an interactive (right-click) path.
	const settled = await Promise.allSettled(
		values.map(({ webviewItemValue }) => getFileCommitFromContext(container, webviewItemValue)),
	);
	const resolved: ResolvedDetailsFile[] = [];
	for (const [index, result] of settled.entries()) {
		const tuple = getSettledValue(result);
		if (tuple == null) continue;

		const [commit, file, comparison] = tuple;
		if (commit != null && file != null) {
			resolved.push({
				commit: commit,
				file: file,
				comparison: comparison,
				webviewItem: values[index].webviewItem,
			});
		}
	}
	return resolved;
}
