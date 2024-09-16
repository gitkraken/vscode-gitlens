import { Uri, workspace } from 'vscode';
import type {
	CloudWorkspacesPathMap,
	CodeWorkspaceFileContents,
	LocalWorkspaceFileData,
	WorkspaceAutoAddSetting,
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
		const cloudWorkspacePathMap = await this.getCloudWorkspacePathMap();
		return cloudWorkspacePathMap[cloudWorkspaceId]?.repoPaths?.[repoId];
	}

	async getCloudWorkspaceCodeWorkspacePath(cloudWorkspaceId: string): Promise<string | undefined> {
		const cloudWorkspacePathMap = await this.getCloudWorkspacePathMap();
		return cloudWorkspacePathMap[cloudWorkspaceId]?.externalLinks?.['.code-workspace'];
	}

	async removeCloudWorkspaceCodeWorkspaceFilePath(cloudWorkspaceId: string): Promise<void> {
		if (!(await acquireSharedFolderWriteLock())) {
			return;
		}

		await this.loadCloudWorkspacePathMap();

		if (this._cloudWorkspacePathMap?.[cloudWorkspaceId]?.externalLinks?.['.code-workspace'] == null) return;

		delete this._cloudWorkspacePathMap[cloudWorkspaceId].externalLinks['.code-workspace'];

		const localFileUri = getSharedCloudWorkspaceMappingFileUri();
		const outputData = new Uint8Array(Buffer.from(JSON.stringify({ workspaces: this._cloudWorkspacePathMap })));
		try {
			await workspace.fs.writeFile(localFileUri, outputData);
		} catch (error) {
			Logger.error(error, 'writeCloudWorkspaceCodeWorkspaceFilePathToMap');
		}
		await releaseSharedFolderWriteLock();
	}

	async confirmCloudWorkspaceCodeWorkspaceFilePath(cloudWorkspaceId: string): Promise<boolean> {
		const cloudWorkspacePathMap = await this.getCloudWorkspacePathMap();
		const codeWorkspaceFilePath = cloudWorkspacePathMap[cloudWorkspaceId]?.externalLinks?.['.code-workspace'];
		if (codeWorkspaceFilePath == null) return false;
		try {
			await workspace.fs.stat(Uri.file(codeWorkspaceFilePath));
			return true;
		} catch {
			return false;
		}
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
			if (data?.length) return JSON.parse(data.toString()) as LocalWorkspaceFileData;
		} catch (_ex) {
			// Fall back to using legacy location for file
			try {
				localFileUri = getSharedLegacyLocalWorkspaceMappingFileUri();
				data = await workspace.fs.readFile(localFileUri);
				if (data?.length) return JSON.parse(data.toString()) as LocalWorkspaceFileData;
			} catch (ex) {
				Logger.error(ex, 'getLocalWorkspaceData');
			}
		}

		return { workspaces: {} };
	}

	async writeCodeWorkspaceFile(
		uri: Uri,
		workspaceRepoFilePaths: string[],
		options?: { workspaceId?: string; workspaceAutoAddSetting?: WorkspaceAutoAddSetting },
	): Promise<boolean> {
		let codeWorkspaceFileContents: CodeWorkspaceFileContents;
		let data;
		try {
			data = await workspace.fs.readFile(uri);
			codeWorkspaceFileContents = JSON.parse(data.toString()) as CodeWorkspaceFileContents;
		} catch (_ex) {
			codeWorkspaceFileContents = { folders: [], settings: {} };
		}

		codeWorkspaceFileContents.folders = workspaceRepoFilePaths.map(repoFilePath => ({ path: repoFilePath }));
		if (options?.workspaceId != null) {
			codeWorkspaceFileContents.settings['gitkraken.workspaceId'] = options.workspaceId;
		}

		if (options?.workspaceAutoAddSetting != null) {
			codeWorkspaceFileContents.settings['gitkraken.workspaceAutoAddSetting'] = options.workspaceAutoAddSetting;
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

	async updateCodeWorkspaceFileSettings(
		uri: Uri,
		options: { workspaceAutoAddSetting?: WorkspaceAutoAddSetting },
	): Promise<boolean> {
		let codeWorkspaceFileContents: CodeWorkspaceFileContents;
		let data;
		try {
			data = await workspace.fs.readFile(uri);
			codeWorkspaceFileContents = JSON.parse(data.toString()) as CodeWorkspaceFileContents;
		} catch (_ex) {
			return false;
		}

		if (options.workspaceAutoAddSetting != null) {
			codeWorkspaceFileContents.settings['gitkraken.workspaceAutoAddSetting'] = options.workspaceAutoAddSetting;
		}

		const outputData = new Uint8Array(Buffer.from(JSON.stringify(codeWorkspaceFileContents)));
		try {
			await workspace.fs.writeFile(uri, outputData);
		} catch (_ex) {
			Logger.error(_ex, 'updateCodeWorkspaceFileSettings');
			return false;
		}

		return true;
	}
}
