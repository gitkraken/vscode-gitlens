import type { Uri } from 'vscode';
import type { LocalWorkspaceFileData } from './models';

export interface WorkspacesPathMappingProvider {
	getCloudWorkspaceRepoPath(cloudWorkspaceId: string, repoId: string): Promise<string | undefined>;

	writeCloudWorkspaceDiskPathToMap(cloudWorkspaceId: string, repoId: string, repoLocalPath: string): Promise<void>;

	getLocalWorkspaceData(): Promise<LocalWorkspaceFileData>;

	writeCodeWorkspaceFile(
		uri: Uri,
		workspaceRepoFilePaths: string[],
		options?: { workspaceId?: string },
	): Promise<boolean>;
}
