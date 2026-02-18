import { Uri, workspace } from 'vscode';
import type { Container } from '../../../container.js';
import type { SharedGkStorageLocationProvider } from '../../../plus/repos/sharedGkStorageLocationProvider.js';
import type { CloudWorkspacesPathMap } from '../../../plus/workspaces/models/cloudWorkspace.js';
import type { LocalWorkspaceFileData } from '../../../plus/workspaces/models/localWorkspace.js';
import type { CodeWorkspaceFileContents, WorkspaceAutoAddSetting } from '../../../plus/workspaces/models/workspaces.js';
import type { GkWorkspacesSharedStorageProvider } from '../../../plus/workspaces/workspacesSharedStorageProvider.js';
import { debug } from '../../../system/decorators/log.js';
import { Logger } from '../../../system/logger.js';
import { getScopedLogger } from '../../../system/logger.scope.js';
import { getGKDLocalWorkspaceMappingFileUri } from './localSharedGkStorageLocationProvider.js';

export class LocalGkWorkspacesSharedStorageProvider implements GkWorkspacesSharedStorageProvider {
	private _cloudWorkspacePathMap: CloudWorkspacesPathMap | undefined = undefined;

	constructor(
		private readonly container: Container,
		private readonly sharedStorage: SharedGkStorageLocationProvider,
	) {}

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
		const localFileUri = await this.sharedStorage.getSharedCloudWorkspaceMappingFileUri();
		try {
			const data = await workspace.fs.readFile(localFileUri);
			this._cloudWorkspacePathMap = (JSON.parse(data.toString())?.workspaces ?? {}) as CloudWorkspacesPathMap;
		} catch (error) {
			Logger.error(error, 'loadCloudWorkspacePathMap');
		}
	}

	@debug()
	async getCloudWorkspaceRepositoryLocation(cloudWorkspaceId: string, repoId: string): Promise<string | undefined> {
		const cloudWorkspacePathMap = await this.getCloudWorkspacePathMap();
		return cloudWorkspacePathMap[cloudWorkspaceId]?.repoPaths?.[repoId];
	}

	@debug()
	async getCloudWorkspaceCodeWorkspaceFileLocation(cloudWorkspaceId: string): Promise<string | undefined> {
		const cloudWorkspacePathMap = await this.getCloudWorkspacePathMap();
		return cloudWorkspacePathMap[cloudWorkspaceId]?.externalLinks?.['.code-workspace'];
	}

	@debug()
	async removeCloudWorkspaceCodeWorkspaceFile(cloudWorkspaceId: string): Promise<void> {
		const scope = getScopedLogger();

		await using lock = await this.sharedStorage.acquireSharedStorageWriteLock();
		if (lock == null) return;

		await this.loadCloudWorkspacePathMap();

		if (this._cloudWorkspacePathMap?.[cloudWorkspaceId]?.externalLinks?.['.code-workspace'] == null) return;

		delete this._cloudWorkspacePathMap[cloudWorkspaceId].externalLinks['.code-workspace'];

		const localFileUri = await this.sharedStorage.getSharedCloudWorkspaceMappingFileUri();
		const outputData = new Uint8Array(Buffer.from(JSON.stringify({ workspaces: this._cloudWorkspacePathMap })));
		try {
			await workspace.fs.writeFile(localFileUri, outputData);
		} catch (ex) {
			scope?.error(ex);
		}
	}

	@debug()
	async confirmCloudWorkspaceCodeWorkspaceFilePath(cloudWorkspaceId: string): Promise<boolean> {
		const codeWorkspaceFilePath = await this.getCloudWorkspaceCodeWorkspaceFileLocation(cloudWorkspaceId);
		if (codeWorkspaceFilePath == null) return false;

		try {
			await workspace.fs.stat(Uri.file(codeWorkspaceFilePath));
			return true;
		} catch {
			return false;
		}
	}

	@debug()
	async storeCloudWorkspaceRepositoryLocation(
		cloudWorkspaceId: string,
		repoId: string,
		repoLocalPath: string,
	): Promise<void> {
		const scope = getScopedLogger();

		await using lock = await this.sharedStorage.acquireSharedStorageWriteLock();
		if (lock == null) return;

		await this.loadCloudWorkspacePathMap();

		this._cloudWorkspacePathMap ??= {};

		this._cloudWorkspacePathMap[cloudWorkspaceId] ??= { repoPaths: {}, externalLinks: {} };

		this._cloudWorkspacePathMap[cloudWorkspaceId].repoPaths ??= {};

		this._cloudWorkspacePathMap[cloudWorkspaceId].repoPaths[repoId] = repoLocalPath;

		const localFileUri = await this.sharedStorage.getSharedCloudWorkspaceMappingFileUri();
		const outputData = new Uint8Array(Buffer.from(JSON.stringify({ workspaces: this._cloudWorkspacePathMap })));
		try {
			await workspace.fs.writeFile(localFileUri, outputData);
		} catch (ex) {
			scope?.error(ex);
		}
	}

	@debug()
	async storeCloudWorkspaceCodeWorkspaceFileLocation(
		cloudWorkspaceId: string,
		codeWorkspaceFilePath: string,
	): Promise<void> {
		const scope = getScopedLogger();

		await using lock = await this.sharedStorage.acquireSharedStorageWriteLock();
		if (lock == null) return;

		await this.loadCloudWorkspacePathMap();

		this._cloudWorkspacePathMap ??= {};

		this._cloudWorkspacePathMap[cloudWorkspaceId] ??= { repoPaths: {}, externalLinks: {} };

		this._cloudWorkspacePathMap[cloudWorkspaceId].externalLinks ??= {};

		this._cloudWorkspacePathMap[cloudWorkspaceId].externalLinks['.code-workspace'] = codeWorkspaceFilePath;

		const localFileUri = await this.sharedStorage.getSharedCloudWorkspaceMappingFileUri();
		const outputData = new Uint8Array(Buffer.from(JSON.stringify({ workspaces: this._cloudWorkspacePathMap })));
		try {
			await workspace.fs.writeFile(localFileUri, outputData);
		} catch (ex) {
			scope?.error(ex);
		}
	}

	// TODO@ramint: May want a file watcher on this file down the line
	async getLocalWorkspaceData(): Promise<LocalWorkspaceFileData> {
		// Read from file at path defined in the constant localWorkspaceDataFilePath
		// If file does not exist, create it and return an empty object
		let localFileUri;
		let data;
		try {
			localFileUri = await this.sharedStorage.getSharedLocalWorkspaceMappingFileUri();
			data = await workspace.fs.readFile(localFileUri);
			if (data?.length) return JSON.parse(data.toString()) as LocalWorkspaceFileData;
		} catch (_ex) {
			// Fall back to using legacy location for file
			try {
				localFileUri = getGKDLocalWorkspaceMappingFileUri();
				data = await workspace.fs.readFile(localFileUri);
				if (data?.length) return JSON.parse(data.toString()) as LocalWorkspaceFileData;
			} catch (ex) {
				Logger.error(ex, 'getLocalWorkspaceData');
			}
		}

		return { workspaces: {} };
	}

	async createOrUpdateCodeWorkspaceFile(
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
				await this.storeCloudWorkspaceCodeWorkspaceFileLocation(options.workspaceId, uri.fsPath);
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
