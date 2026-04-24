import type { Uri } from 'vscode';
import type { GitCommit } from '@gitlens/git/models/commit.js';
import { GitFileChange } from '@gitlens/git/models/fileChange.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import { isUncommitted } from '@gitlens/git/utils/revision.utils.js';
import type { Container } from '../../container.js';
import { findCommitFile, getCommitForFile } from '../../git/utils/-webview/commit.utils.js';
import { isWebviewItemContext } from '../../system/webview.js';
import type {
	DetailsFileContextValue,
	DetailsItemContext,
	DetailsItemTypedContext,
	DetailsItemTypedContextValue,
} from './protocol.js';

export function isDetailsItemContext(item: unknown): item is DetailsItemContext {
	if (item == null) return false;

	return (
		isWebviewItemContext(item) &&
		(item.webview === 'gitlens.views.commitDetails' ||
			item.webview === 'gitlens.views.graphDetails' ||
			// The embedded graph details panel lives inside the graph webview,
			// so VS Code may pass the graph panel/view ID as the webview context
			item.webview === 'gitlens.graph' ||
			item.webview === 'gitlens.views.graph')
	);
}

export function isDetailsItemTypedContext(item: unknown, type: 'file'): item is DetailsItemTypedContext;
export function isDetailsItemTypedContext(
	item: unknown,
	type: DetailsItemTypedContextValue['type'],
): item is DetailsItemTypedContext {
	if (item == null) return false;

	return (
		isDetailsItemContext(item) && typeof item.webviewItemValue === 'object' && item.webviewItemValue.type === type
	);
}

export function isDetailsFileContext(item: unknown): item is DetailsItemTypedContext {
	if (item == null) return false;

	return isDetailsItemTypedContext(item, 'file');
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

export type ComparisonContext = { sha: string };

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
