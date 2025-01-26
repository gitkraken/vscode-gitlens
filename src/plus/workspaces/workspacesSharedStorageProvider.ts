import type { Uri } from 'vscode';
import type { LocalWorkspaceFileData } from './models/localWorkspace';
import type { WorkspaceAutoAddSetting } from './models/workspaces';

export interface GkWorkspacesSharedStorageProvider {
	getCloudWorkspaceRepositoryLocation(cloudWorkspaceId: string, repoId: string): Promise<string | undefined>;

	getCloudWorkspaceCodeWorkspaceFileLocation(cloudWorkspaceId: string): Promise<string | undefined>;

	removeCloudWorkspaceCodeWorkspaceFile(cloudWorkspaceId: string): Promise<void>;

	storeCloudWorkspaceCodeWorkspaceFileLocation(
		cloudWorkspaceId: string,
		codeWorkspaceFilePath: string,
	): Promise<void>;

	confirmCloudWorkspaceCodeWorkspaceFilePath(cloudWorkspaceId: string): Promise<boolean>;

	storeCloudWorkspaceRepositoryLocation(
		cloudWorkspaceId: string,
		repoId: string,
		repoLocalPath: string,
	): Promise<void>;

	getLocalWorkspaceData(): Promise<LocalWorkspaceFileData>;

	createOrUpdateCodeWorkspaceFile(
		uri: Uri,
		workspaceRepoFilePaths: string[],
		options?: { workspaceId?: string; workspaceAutoAddSetting?: WorkspaceAutoAddSetting },
	): Promise<boolean>;

	updateCodeWorkspaceFileSettings(
		uri: Uri,
		options: { workspaceAutoAddSetting?: WorkspaceAutoAddSetting },
	): Promise<boolean>;
}
