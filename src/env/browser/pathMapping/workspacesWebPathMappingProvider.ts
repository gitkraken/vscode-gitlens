import { Uri } from 'vscode';
import type { LocalWorkspaceFileData, WorkspaceAutoAddSetting } from '../../../plus/workspaces/models';
import type { WorkspacesPathMappingProvider } from '../../../plus/workspaces/workspacesPathMappingProvider';

export class WorkspacesWebPathMappingProvider implements WorkspacesPathMappingProvider {
	async getCloudWorkspaceRepoPath(_cloudWorkspaceId: string, _repoId: string): Promise<string | undefined> {
		return undefined;
	}

	async getCloudWorkspaceCodeWorkspacePath(_cloudWorkspaceId: string): Promise<string | undefined> {
		return undefined;
	}

	async removeCloudWorkspaceCodeWorkspaceFilePath(_cloudWorkspaceId: string): Promise<void> {}

	async writeCloudWorkspaceCodeWorkspaceFilePathToMap(
		_cloudWorkspaceId: string,
		_codeWorkspaceFilePath: string,
	): Promise<void> {}

	async confirmCloudWorkspaceCodeWorkspaceFilePath(_cloudWorkspaceId: string): Promise<boolean> {
		return false;
	}

	async writeCloudWorkspaceRepoDiskPathToMap(
		_cloudWorkspaceId: string,
		_repoId: string,
		_repoLocalPath: string,
	): Promise<void> {}

	async getLocalWorkspaceData(): Promise<LocalWorkspaceFileData> {
		return { workspaces: {} };
	}

	async writeCodeWorkspaceFile(
		_uri: Uri,
		_workspaceRepoFilePaths: string[],
		_options?: { workspaceId?: string; workspaceAutoAddSetting?: WorkspaceAutoAddSetting },
	): Promise<boolean> {
		return false;
	}

	async updateCodeWorkspaceFileSettings(
		_uri: Uri,
		_options: { workspaceAutoAddSetting?: WorkspaceAutoAddSetting },
	): Promise<boolean> {
		return false;
	}
}
