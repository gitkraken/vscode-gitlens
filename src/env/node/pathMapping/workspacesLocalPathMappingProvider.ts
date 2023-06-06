import type { Uri } from 'vscode';
import { workspace } from 'vscode';
import type {
	CloudWorkspacesPathMap,
	CodeWorkspaceFileContents,
	LocalWorkspaceFileData,
} from '../../../plus/workspaces/models';
import type { WorkspacesPathMappingProvider } from '../../../plus/workspaces/workspacesPathMappingProvider';
import { Logger } from '../../../system/logger';
import {
	acquireSharedFolderWriteLock,
	getSharedCloudWorkspaceMappingFileUri,
	getSharedLegacyLocalWorkspaceMappingFileUri,
	getSharedLocalWorkspaceMappingFileUri,
	releaseSharedFolderWriteLock,
} from './sharedGKDataFolder';

export class WorkspacesLocalPathMappingProvider implements WorkspacesPathMappingProvider {
	private _cloudWorkspaceRepoPathMap: CloudWorkspacesPathMap | undefined = undefined;

	private async ensureCloudWorkspaceRepoPathMap(): Promise<void> {
		if (this._cloudWorkspaceRepoPathMap == null) {
			await this.loadCloudWorkspaceRepoPathMap();
		}
	}

	private async getCloudWorkspaceRepoPathMap(): Promise<CloudWorkspacesPathMap> {
		await this.ensureCloudWorkspaceRepoPathMap();
		return this._cloudWorkspaceRepoPathMap ?? {};
	}

	private async loadCloudWorkspaceRepoPathMap(): Promise<void> {
		const localFileUri = getSharedCloudWorkspaceMappingFileUri();
		try {
			const data = await workspace.fs.readFile(localFileUri);
			this._cloudWorkspaceRepoPathMap = (JSON.parse(data.toString())?.workspaces ?? {}) as CloudWorkspacesPathMap;
		} catch (error) {
			Logger.error(error, 'loadCloudWorkspaceRepoPathMap');
		}
	}

	async getCloudWorkspaceRepoPath(cloudWorkspaceId: string, repoId: string): Promise<string | undefined> {
		const cloudWorkspaceRepoPathMap = await this.getCloudWorkspaceRepoPathMap();
		return cloudWorkspaceRepoPathMap[cloudWorkspaceId]?.repoPaths[repoId];
	}

	async writeCloudWorkspaceDiskPathToMap(
		cloudWorkspaceId: string,
		repoId: string,
		repoLocalPath: string,
	): Promise<void> {
		if (!(await acquireSharedFolderWriteLock())) {
			return;
		}

		await this.loadCloudWorkspaceRepoPathMap();

		if (this._cloudWorkspaceRepoPathMap == null) {
			this._cloudWorkspaceRepoPathMap = {};
		}

		if (this._cloudWorkspaceRepoPathMap[cloudWorkspaceId] == null) {
			this._cloudWorkspaceRepoPathMap[cloudWorkspaceId] = { repoPaths: {} };
		}

		this._cloudWorkspaceRepoPathMap[cloudWorkspaceId].repoPaths[repoId] = repoLocalPath;

		const localFileUri = getSharedCloudWorkspaceMappingFileUri();
		const outputData = new Uint8Array(Buffer.from(JSON.stringify({ workspaces: this._cloudWorkspaceRepoPathMap })));
		try {
			await workspace.fs.writeFile(localFileUri, outputData);
		} catch (error) {
			Logger.error(error, 'writeCloudWorkspaceDiskPathToMap');
		}
		await releaseSharedFolderWriteLock();
	}

	// TODO@ramint: May want a file watcher on this file down the line
	async getLocalWorkspaceData(): Promise<LocalWorkspaceFileData> {
		// Read from file at path defined in the constant localWorkspaceDataFilePath
		// If file does not exist, create it and return an empty object
		let localFileUri;
		let data;
		try {
			localFileUri = getSharedLocalWorkspaceMappingFileUri();
			data = await workspace.fs.readFile(localFileUri);
			return JSON.parse(data.toString()) as LocalWorkspaceFileData;
		} catch (error) {
			// Fall back to using legacy location for file
			try {
				localFileUri = getSharedLegacyLocalWorkspaceMappingFileUri();
				data = await workspace.fs.readFile(localFileUri);
				return JSON.parse(data.toString()) as LocalWorkspaceFileData;
			} catch (error) {
				Logger.error(error, 'getLocalWorkspaceData');
			}
		}

		return { workspaces: {} };
	}

	async writeCodeWorkspaceFile(
		uri: Uri,
		workspaceRepoFilePaths: string[],
		options?: { workspaceId?: string },
	): Promise<boolean> {
		let codeWorkspaceFileContents: CodeWorkspaceFileContents;
		let data;
		try {
			data = await workspace.fs.readFile(uri);
			codeWorkspaceFileContents = JSON.parse(data.toString()) as CodeWorkspaceFileContents;
		} catch (error) {
			codeWorkspaceFileContents = { folders: [], settings: {} };
		}

		codeWorkspaceFileContents.folders = workspaceRepoFilePaths.map(repoFilePath => ({ path: repoFilePath }));
		if (options?.workspaceId != null) {
			codeWorkspaceFileContents.settings['gitkraken.workspaceId'] = options.workspaceId;
		}

		const outputData = new Uint8Array(Buffer.from(JSON.stringify(codeWorkspaceFileContents)));
		try {
			await workspace.fs.writeFile(uri, outputData);
		} catch (error) {
			Logger.error(error, 'writeCodeWorkspaceFile');
			return false;
		}

		return true;
	}
}
