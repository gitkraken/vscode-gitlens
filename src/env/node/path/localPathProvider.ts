import os from 'os';
import path from 'path';
import type { Disposable } from 'vscode';
import { Uri, workspace } from 'vscode';
import { localGKSharedDataFolder } from '../../../constants';
import type { Container } from '../../../container';
import type { LocalRepoDataMap } from '../../../path/models';
import { localRepoMappingFilePath } from '../../../path/models';
import type { PathProvider } from '../../../path/pathProvider';
import { Logger } from '../../../system/logger';
import { acquireSharedFolderWriteLock, releaseSharedFolderWriteLock } from './utils';

export class LocalPathProvider implements PathProvider, Disposable {
	constructor(private readonly container: Container) {}

	dispose() {}

	private _localRepoDataMap: LocalRepoDataMap | undefined = undefined;

	private async ensureLocalRepoDataMap() {
		if (this._localRepoDataMap == null) {
			await this.loadLocalRepoDataMap();
		}
	}

	private async getLocalRepoDataMap(): Promise<LocalRepoDataMap> {
		await this.ensureLocalRepoDataMap();
		return this._localRepoDataMap ?? {};
	}

	async getLocalRepoPaths(options: {
		remoteUrl?: string;
		repoInfo?: { provider: string; owner: string; repoName: string };
	}): Promise<string[]> {
		const paths: string[] = [];
		if (options.remoteUrl != null) {
			const remoteUrlPaths = await this._getLocalRepoPaths(options.remoteUrl);
			if (remoteUrlPaths != null) {
				paths.push(...remoteUrlPaths);
			}
		}
		if (options.repoInfo != null) {
			const { provider, owner, repoName } = options.repoInfo;
			const repoInfoPaths = await this._getLocalRepoPaths(`${provider}/${owner}/${repoName}`);
			if (repoInfoPaths != null) {
				paths.push(...repoInfoPaths);
			}
		}

		return paths;
	}

	private async _getLocalRepoPaths(key: string): Promise<string[] | undefined> {
		const localRepoDataMap = await this.getLocalRepoDataMap();
		return localRepoDataMap[key]?.paths;
	}

	private async loadLocalRepoDataMap() {
		const localFilePath = path.join(os.homedir(), localGKSharedDataFolder, localRepoMappingFilePath);
		try {
			const data = await workspace.fs.readFile(Uri.file(localFilePath));
			this._localRepoDataMap = (JSON.parse(data.toString()) ?? {}) as LocalRepoDataMap;
		} catch (error) {
			Logger.error(error, 'loadLocalRepoDataMap');
		}
	}

	async writeLocalRepoPath(
		options: { remoteUrl?: string; repoInfo?: { provider: string; owner: string; repoName: string } },
		localPath: string,
	): Promise<void> {
		if (options.remoteUrl != null) {
			await this._writeLocalRepoPath(options.remoteUrl, localPath);
		}
		if (
			options.repoInfo?.provider != null &&
			options.repoInfo?.owner != null &&
			options.repoInfo?.repoName != null
		) {
			const { provider, owner, repoName } = options.repoInfo;
			const key = `${provider}/${owner}/${repoName}`;
			await this._writeLocalRepoPath(key, localPath);
		}
	}

	private async _writeLocalRepoPath(key: string, localPath: string): Promise<void> {
		if (!(await acquireSharedFolderWriteLock())) {
			return;
		}

		await this.loadLocalRepoDataMap();
		if (this._localRepoDataMap == null) {
			this._localRepoDataMap = {};
		}

		if (this._localRepoDataMap[key] == null || this._localRepoDataMap[key].paths == null) {
			this._localRepoDataMap[key] = { paths: [localPath] };
		} else if (!this._localRepoDataMap[key].paths.includes(localPath)) {
			this._localRepoDataMap[key].paths.push(localPath);
		}
		const localFilePath = path.join(os.homedir(), localGKSharedDataFolder, localRepoMappingFilePath);
		const outputData = new Uint8Array(Buffer.from(JSON.stringify(this._localRepoDataMap)));
		try {
			await workspace.fs.writeFile(Uri.file(localFilePath), outputData);
		} catch (error) {
			Logger.error(error, 'writeLocalRepoPath');
		}
		await releaseSharedFolderWriteLock();
	}
}
