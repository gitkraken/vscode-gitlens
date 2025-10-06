import type { Uri } from 'vscode';
import type { Container } from '../../container';
import type { GitCommit } from '../../git/models/commit';
import type { GitFileChange } from '../../git/models/fileChange';
import { uncommitted } from '../../git/models/revision';
import { isUncommitted } from '../../git/utils/revision.utils';
import { isWebviewItemContext } from '../../system/webview';
import type {
	DetailsFileContextValue,
	DetailsItemContext,
	DetailsItemTypedContext,
	DetailsItemTypedContextValue,
} from './protocol';

export function isDetailsItemContext(item: unknown): item is DetailsItemContext {
	if (item == null) return false;

	return (
		isWebviewItemContext(item) &&
		(item.webview === 'gitlens.views.commitDetails' || item.webview === 'gitlens.views.graphDetails')
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

export async function getFileCommitFromContext(
	container: Container,
	context: DetailsFileContextValue,
): Promise<[commit: GitCommit, file: GitFileChange] | [commit?: undefined, file?: undefined]> {
	const { path, repoPath, sha, staged, stashNumber } = context;
	const svc = container.git.getRepositoryService(repoPath);

	if (stashNumber != null) {
		const stash = await svc.stash?.getStash();
		const commit = stash?.stashes.get(sha!);
		if (commit == null) return [];

		const file = await commit.findFile(path);
		return commit != null && file != null ? [commit, file] : [];
	}

	if (isUncommitted(sha)) {
		let commit = await svc.commits.getCommit(uncommitted);
		commit = await commit?.getCommitForFile(path, staged);
		return commit?.file != null ? [commit, commit.file] : [];
	}

	const uri = getUriFromContext(container, context);
	if (uri == null) return [];

	const commit = await svc.commits.getCommitForFile(uri, sha);
	return commit?.file != null ? [commit, commit.file] : [];
}
