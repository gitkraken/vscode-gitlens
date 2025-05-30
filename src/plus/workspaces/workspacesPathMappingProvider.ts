import type { Uri } from 'vscode';
import type { LocalWorkspaceFileData, WorkspaceSyncSetting } from './models';

export interface WorkspacesPathMappingProvider {
	getCloudWorkspaceRepoPath(cloudWorkspaceId: string, repoId: string): Promise<string | undefined>;

	getCloudWorkspaceCodeWorkspacePath(cloudWorkspaceId: string): Promise<string | undefined>;

	removeCloudWorkspaceCodeWorkspaceFilePath(cloudWorkspaceId: string): Promise<void>;

	writeCloudWorkspaceCodeWorkspaceFilePathToMap(
		cloudWorkspaceId: string,
		codeWorkspaceFilePath: string,
	): Promise<void>;

	confirmCloudWorkspaceCodeWorkspaceFilePath(cloudWorkspaceId: string): Promise<boolean>;

	writeCloudWorkspaceRepoDiskPathToMap(
		cloudWorkspaceId: string,
		repoId: string,
		repoLocalPath: string,
	): Promise<void>;

	getLocalWorkspaceData(): Promise<LocalWorkspaceFileData>;

	writeCodeWorkspaceFile(
		uri: Uri,
		workspaceRepoFilePaths: string[],
		options?: { workspaceId?: string; workspaceSyncSetting?: WorkspaceSyncSetting },
	): Promise<boolean>;
}
