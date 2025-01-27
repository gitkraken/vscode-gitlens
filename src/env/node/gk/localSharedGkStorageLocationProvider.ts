import { homedir } from 'os';
import { join } from 'path';
import { env } from 'process';
import { Uri, workspace } from 'vscode';
import type { Container } from '../../../container';
import type { SharedGkStorageLocationProvider } from '../../../plus/repos/sharedGkStorageLocationProvider';
import { log } from '../../../system/decorators/log';
import type { Lazy } from '../../../system/lazy';
import { lazy } from '../../../system/lazy';
import { getLoggableName, Logger } from '../../../system/logger';
import { getLogScope, startLogScope } from '../../../system/logger.scope';
import { wait } from '../../../system/promise';
import type { UnifiedAsyncDisposable } from '../../../system/unifiedDisposable';
import { createAsyncDisposable } from '../../../system/unifiedDisposable';
import { getPlatform } from '../platform';

export class LocalSharedGkStorageLocationProvider implements SharedGkStorageLocationProvider {
	private readonly _lazySharedGKUri: Lazy<Promise<Uri>>;

	constructor(private readonly container: Container) {
		this._lazySharedGKUri = lazy(async () => {
			using scope = startLogScope(`${getLoggableName(this)}.load`, false);

			/** Deprecated prefer using XDG paths */
			const legacySharedGKPath = join(homedir(), '.gk');
			const legacySharedGKUri = Uri.file(legacySharedGKPath);

			// Look for the original shared GK path first, and if not found, use the new XDG path
			let path;
			try {
				await workspace.fs.stat(legacySharedGKUri);
			} catch {
				path = env.XDG_DATA_HOME;
				if (!path) {
					const platform = getPlatform();
					switch (platform) {
						case 'windows':
							path = env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
							break;
						case 'macOS':
							path = join(homedir(), 'Library', 'Application Support');
							break;
						case 'linux':
							path = join(homedir(), '.local', 'share');
							break;
					}
				}

				if (path) {
					path = join(path, 'gk');
					Logger.log(scope, `Using shared GK path: ${path}`);
				}
			}

			if (path) return Uri.file(path);

			Logger.log(scope, `Using legacy shared GK path: ${legacySharedGKPath}`);
			return legacySharedGKUri;
		});
	}

	private async getUri(relativeFilePath: string) {
		return Uri.joinPath(await this._lazySharedGKUri.value, relativeFilePath);
	}

	@log()
	async acquireSharedStorageWriteLock(): Promise<UnifiedAsyncDisposable | undefined> {
		const scope = getLogScope();

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
		} catch (ex) {
			Logger.error(ex, scope, `Failed to acquire lock: ${lockFileUri.toString(true)}`);
			return undefined;
		}

		return createAsyncDisposable(() => this.releaseSharedStorageWriteLock());
	}

	@log()
	async releaseSharedStorageWriteLock(): Promise<boolean> {
		const scope = getLogScope();

		const lockFileUri = await this.getUri('lockfile');

		try {
			await workspace.fs.delete(lockFileUri);
		} catch (ex) {
			Logger.error(ex, scope, `Failed to release lock: ${lockFileUri.toString(true)}`);
			return false;
		}

		return true;
	}

	async getSharedRepositoryLocationFileUri(): Promise<Uri> {
		return this.getUri('repoMapping.json');
	}

	async getSharedCloudWorkspaceMappingFileUri(): Promise<Uri> {
		return this.getUri('cloudWorkspaces.json');
	}

	async getSharedLocalWorkspaceMappingFileUri(): Promise<Uri> {
		return this.getUri('localWorkspaces.json');
	}
}

export function getGKDLocalWorkspaceMappingFileUri(): Uri {
	return Uri.file(
		join(
			homedir(),
			`${getPlatform() === 'windows' ? '/AppData/Roaming/' : ''}.gitkraken`,
			'workspaces',
			'workspaces.json',
		),
	);
}
