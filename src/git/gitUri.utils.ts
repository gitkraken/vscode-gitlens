import type { Uri } from 'vscode';
import type { Container } from '../container';
import { GitUri, isGitUri } from './gitUri';

export async function ensureWorkingUri(container: Container, uri: Uri | undefined): Promise<Uri | undefined> {
	if (uri == null) return undefined;

	const gitUri = !isGitUri(uri) ? await GitUri.fromUri(uri) : uri;
	if (gitUri.sha != null) {
		// If we have a sha, normalize the history to the working file (so we get a full history all the time)
		const workingUri = await container.git.getWorkingUri(gitUri.repoPath!, gitUri);
		if (workingUri != null) {
			uri = workingUri;
		}
	}

	return uri;
}
