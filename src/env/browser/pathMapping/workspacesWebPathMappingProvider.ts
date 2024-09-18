import type { Uri } from 'vscode';
import type { LocalWorkspaceFileData, WorkspaceAutoAddSetting } from '../../../plus/workspaces/models';
import type { WorkspacesPathMappingProvider } from '../../../plus/workspaces/workspacesPathMappingProvider';

export class WorkspacesWebPathMappingProvider implements WorkspacesPathMappingProvider {
	getCloudWorkspaceRepoPath(_cloudWorkspaceId: string, _repoId: string): Promise<string | undefined> {
		return Promise.resolve(undefined);
	}

	getCloudWorkspaceCodeWorkspacePath(_cloudWorkspaceId: string): Promise<string | undefined> {
		return Promise.resolve(undefined);
	}

	async removeCloudWorkspaceCodeWorkspaceFilePath(_cloudWorkspaceId: string): Promise<void> {}

	async writeCloudWorkspaceCodeWorkspaceFilePathToMap(
		_cloudWorkspaceId: string,
		_codeWorkspaceFilePath: string,
	): Promise<void> {}

	confirmCloudWorkspaceCodeWorkspaceFilePath(_cloudWorkspaceId: string): Promise<boolean> {
		return Promise.resolve(false);
	}

	async writeCloudWorkspaceRepoDiskPathToMap(
		_cloudWorkspaceId: string,
		_repoId: string,
		_repoLocalPath: string,
	): Promise<void> {}

	getLocalWorkspaceData(): Promise<LocalWorkspaceFileData> {
		return Promise.resolve({ workspaces: {} });
	}

	writeCodeWorkspaceFile(
		_uri: Uri,
		_workspaceRepoFilePaths: string[],
		_options?: { workspaceId?: string; workspaceAutoAddSetting?: WorkspaceAutoAddSetting },
	): Promise<boolean> {
		return Promise.resolve(false);
	}

	updateCodeWorkspaceFileSettings(
		_uri: Uri,
		_options: { workspaceAutoAddSetting?: WorkspaceAutoAddSetting },
	): Promise<boolean> {
		return Promise.resolve(false);
	}
}
