import type { Uri } from 'vscode';
import type { GitCommit } from '@gitlens/git/models/commit.js';
import { GitFileChange } from '@gitlens/git/models/fileChange.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import { isUncommitted } from '@gitlens/git/utils/revision.utils.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import type { Container } from '../../container.js';
import { findCommitFile, getCommitForFile } from '../../git/utils/-webview/commit.utils.js';
import { isWebviewItemContext } from '../../system/webview.js';
import type {
	DetailsFileContextValue,
	DetailsFolderContextValue,
	DetailsItemContext,
	DetailsItemTypedContext,
	DetailsItemTypedContextValue,
} from './protocol.js';

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
