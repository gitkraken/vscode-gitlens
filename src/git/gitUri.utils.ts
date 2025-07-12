import type { Uri } from 'vscode';
import type { Container } from '../container';
import { GitUri, isGitUri } from './gitUri';

export async function ensureWorkingUri(container: Container, uri: Uri | undefined): Promise<Uri | undefined> {
	if (uri == null) return undefined;
	if (!container.git.isTrackable(uri)) return undefined;

	const gitUri = !isGitUri(uri) ? await GitUri.fromUri(uri) : uri;
	if (gitUri.sha) {
		// If we have a sha, normalize the history to the working file (so we get a full history all the time)
		const workingUri = await container.git.getRepositoryService(gitUri.repoPath!).getWorkingUri(gitUri);
		if (workingUri != null) {
			uri = workingUri;
		}
	} else if (!(await container.git.isTracked(uri))) {
		return undefined;
	}

	return uri;
}
