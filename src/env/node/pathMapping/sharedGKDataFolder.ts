import os from 'os';
import path from 'path';
import { env } from 'process';
import { Uri, workspace } from 'vscode';
import { xdgData } from 'xdg-basedir';
import { Logger } from '../../../system/logger';
import { wait } from '../../../system/promise';
import { getPlatform } from '../platform';

/** @deprecated prefer using XDG paths */
const legacySharedGKDataFolder = path.join(os.homedir(), '.gk');

class SharedGKDataFolderMapper {
	private _initPromise: Promise<void> | undefined;
	constructor(
		// do soft migration, use new folders only for new users (without existing folders)
		// eslint-disable-next-line @typescript-eslint/no-deprecated
		private sharedGKDataFolder = legacySharedGKDataFolder,
		private _isInitialized: boolean = false,
	) {}

	private async _initialize() {
		if (this._initPromise) {
			throw new Error('cannot be initialized multiple times');
		}
		try {
			await workspace.fs.stat(Uri.file(this.sharedGKDataFolder));
		} catch {
			// Path does not exist, so we can safely use xdg paths
			const platform = getPlatform();
			const folderName = 'gk';
			switch (platform) {
				case 'windows':
					if (env.LOCALAPPDATA) {
						this.sharedGKDataFolder = path.join(env.LOCALAPPDATA, folderName, 'Data');
					} else {
						this.sharedGKDataFolder = path.join(os.homedir(), 'AppData', 'Local', folderName, 'Data');
					}
					break;
				case 'macOS':
					this.sharedGKDataFolder = path.join(os.homedir(), 'Library', 'Application Support', folderName);
					break;
				default:
					if (xdgData) {
						this.sharedGKDataFolder = path.join(xdgData, folderName);
					} else {
						this.sharedGKDataFolder = path.join(os.homedir(), '.local', 'share', folderName);
					}
			}
		} finally {
			this._isInitialized = true;
		}
	}

	private async waitForInitialized() {
		if (this._isInitialized) {
			return;
		}
		if (!this._initPromise) {
			this._initPromise = this._initialize();
		}
		await this._initPromise;
	}

	private async getUri(relativeFilePath: string) {
		await this.waitForInitialized();
		return Uri.file(path.join(this.sharedGKDataFolder, relativeFilePath));
	}

	async acquireSharedFolderWriteLock(): Promise<boolean> {
		const lockFileUri = await this.getUri('lockfile');

		let stat;
		while (true) {
			try {
				stat = await workspace.fs.stat(lockFileUri);
			} catch {
				// File does not exist, so we can safely create it
				break;
			}

			const currentTime = new Date().getTime();
			if (currentTime - stat.ctime > 30000) {
				// File exists, but the timestamp is older than 30 seconds, so we can safely remove it
				break;
			}

			// File exists, and the timestamp is less than 30 seconds old, so we need to wait for it to be removed
			await wait(100);
		}

		try {
			// write the lockfile to the shared data folder
			await workspace.fs.writeFile(lockFileUri, new Uint8Array(0));
		} catch (error) {
			Logger.error(error, 'acquireSharedFolderWriteLock');
			return false;
		}

		return true;
	}

	async releaseSharedFolderWriteLock(): Promise<boolean> {
		try {
			const lockFileUri = await this.getUri('lockfile');
			await workspace.fs.delete(lockFileUri);
		} catch (error) {
			Logger.error(error, 'releaseSharedFolderWriteLock');
			return false;
		}

		return true;
	}

	async getSharedRepositoryMappingFileUri() {
		return this.getUri('repoMapping.json');
	}

	async getSharedCloudWorkspaceMappingFileUri() {
		return this.getUri('cloudWorkspaces.json');
	}

	async getSharedLocalWorkspaceMappingFileUri() {
		return this.getUri('localWorkspaces.json');
	}
}

// export as a singleton
const instance = new SharedGKDataFolderMapper();
export { instance as SharedGKDataFolderMapper };

export function getSharedLegacyLocalWorkspaceMappingFileUri() {
	return Uri.file(
		path.join(
			os.homedir(),
			`${getPlatform() === 'windows' ? '/AppData/Roaming/' : ''}.gitkraken`,
			'workspaces',
			'workspaces.json',
		),
	);
}
