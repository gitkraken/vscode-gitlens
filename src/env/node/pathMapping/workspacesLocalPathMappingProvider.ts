import { Uri, workspace } from 'vscode';
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
	private _cloudWorkspacePathMap: CloudWorkspacesPathMap | undefined = undefined;

	private async ensureCloudWorkspacePathMap(): Promise<void> {
		if (this._cloudWorkspacePathMap == null) {
			await this.loadCloudWorkspacePathMap();
		}
	}

	private async getCloudWorkspacePathMap(): Promise<CloudWorkspacesPathMap> {
		await this.ensureCloudWorkspacePathMap();
		return this._cloudWorkspacePathMap ?? {};
	}

	private async loadCloudWorkspacePathMap(): Promise<void> {
		const localFileUri = getSharedCloudWorkspaceMappingFileUri();
		try {
			const data = await workspace.fs.readFile(localFileUri);
			this._cloudWorkspacePathMap = (JSON.parse(data.toString())?.workspaces ?? {}) as CloudWorkspacesPathMap;
		} catch (error) {
			Logger.error(error, 'loadCloudWorkspacePathMap');
		}
	}

	async getCloudWorkspaceRepoPath(cloudWorkspaceId: string, repoId: string): Promise<string | undefined> {
		const cloudWorkspaceRepoPathMap = await this.getCloudWorkspacePathMap();
		return cloudWorkspaceRepoPathMap[cloudWorkspaceId]?.repoPaths?.[repoId];
	}

	async getCloudWorkspaceCodeWorkspacePath(cloudWorkspaceId: string): Promise<string | undefined> {
		const cloudWorkspaceRepoPathMap = await this.getCloudWorkspacePathMap();
		return cloudWorkspaceRepoPathMap[cloudWorkspaceId]?.externalLinks?.['.code-workspace'];
	}

	async writeCloudWorkspaceRepoDiskPathToMap(
		cloudWorkspaceId: string,
		repoId: string,
		repoLocalPath: string,
	): Promise<void> {
		if (!(await acquireSharedFolderWriteLock())) {
			return;
		}

		await this.loadCloudWorkspacePathMap();

		if (this._cloudWorkspacePathMap == null) {
			this._cloudWorkspacePathMap = {};
		}

		if (this._cloudWorkspacePathMap[cloudWorkspaceId] == null) {
			this._cloudWorkspacePathMap[cloudWorkspaceId] = { repoPaths: {}, externalLinks: {} };
		}

		if (this._cloudWorkspacePathMap[cloudWorkspaceId].repoPaths == null) {
			this._cloudWorkspacePathMap[cloudWorkspaceId].repoPaths = {};
		}

		this._cloudWorkspacePathMap[cloudWorkspaceId].repoPaths[repoId] = repoLocalPath;

		const localFileUri = getSharedCloudWorkspaceMappingFileUri();
		const outputData = new Uint8Array(Buffer.from(JSON.stringify({ workspaces: this._cloudWorkspacePathMap })));
		try {
			await workspace.fs.writeFile(localFileUri, outputData);
		} catch (error) {
			Logger.error(error, 'writeCloudWorkspaceRepoDiskPathToMap');
		}
		await releaseSharedFolderWriteLock();
	}

	async writeCloudWorkspaceCodeWorkspaceFilePathToMap(
		cloudWorkspaceId: string,
		codeWorkspaceFilePath: string,
	): Promise<void> {
		if (!(await acquireSharedFolderWriteLock())) {
			return;
		}

		await this.loadCloudWorkspacePathMap();

		if (this._cloudWorkspacePathMap == null) {
			this._cloudWorkspacePathMap = {};
		}

		if (this._cloudWorkspacePathMap[cloudWorkspaceId] == null) {
			this._cloudWorkspacePathMap[cloudWorkspaceId] = { repoPaths: {}, externalLinks: {} };
		}

		if (this._cloudWorkspacePathMap[cloudWorkspaceId].externalLinks == null) {
			this._cloudWorkspacePathMap[cloudWorkspaceId].externalLinks = {};
		}

		this._cloudWorkspacePathMap[cloudWorkspaceId].externalLinks['.code-workspace'] = codeWorkspaceFilePath;

		const localFileUri = getSharedCloudWorkspaceMappingFileUri();
		const outputData = new Uint8Array(Buffer.from(JSON.stringify({ workspaces: this._cloudWorkspacePathMap })));
		try {
			await workspace.fs.writeFile(localFileUri, outputData);
		} catch (error) {
			Logger.error(error, 'writeCloudWorkspaceCodeWorkspaceFilePathToMap');
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
			if (options?.workspaceId != null) {
				await this.writeCloudWorkspaceCodeWorkspaceFilePathToMap(options.workspaceId, uri.fsPath);
			}
		} catch (error) {
			Logger.error(error, 'writeCodeWorkspaceFile');
			return false;
		}

		return true;
	}

	async confirmCloudWorkspaceCodeWorkspaceFileMatch(
		cloudWorkspaceId: string,
		codeWorkspaceFilePath: string,
	): Promise<boolean> {
		const codeWorkspaceFileUri = Uri.file(codeWorkspaceFilePath);
		let codeWorkspaceFileContents: CodeWorkspaceFileContents;
		try {
			const data = await workspace.fs.readFile(codeWorkspaceFileUri);
			codeWorkspaceFileContents = JSON.parse(data.toString()) as CodeWorkspaceFileContents;
		} catch (error) {
			return false;
		}

		if (codeWorkspaceFileContents == null) {
			return false;
		}

		if (codeWorkspaceFileContents.settings?.['gitkraken.workspaceId'] !== cloudWorkspaceId) {
			return false;
		}

		return true;
	}
}
