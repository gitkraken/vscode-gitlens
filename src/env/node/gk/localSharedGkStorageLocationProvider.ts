import { homedir } from 'os';
import { join } from 'path';
import { env } from 'process';
import { Uri, workspace } from 'vscode';
import type { Container } from '../../../container.js';
import type { SharedGkStorageLocationProvider } from '../../../plus/repos/sharedGkStorageLocationProvider.js';
import { debug } from '../../../system/decorators/log.js';
import type { Lazy } from '../../../system/lazy.js';
import { lazy } from '../../../system/lazy.js';
import { getLoggableName, Logger } from '../../../system/logger.js';
import { getScopedLogger, startScopedLogger } from '../../../system/logger.scope.js';
import { wait } from '../../../system/promise.js';
import type { UnifiedAsyncDisposable } from '../../../system/unifiedDisposable.js';
import { createAsyncDisposable } from '../../../system/unifiedDisposable.js';
import { getPlatform } from '../platform.js';

export class LocalSharedGkStorageLocationProvider implements SharedGkStorageLocationProvider {
	private readonly _lazySharedGKUri: Lazy<Promise<Uri>>;

	constructor(private readonly container: Container) {
		this._lazySharedGKUri = lazy(async () => {
			using scope = startScopedLogger(`${getLoggableName(this)}.load`, false);

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
					Logger.debug(scope, `Using shared GK path: ${path}`);
				}
			}

			if (path) return Uri.file(path);

			Logger.debug(scope, `Using legacy shared GK path: ${legacySharedGKPath}`);
			return legacySharedGKUri;
		});
	}

	private async getUri(relativeFilePath: string) {
		return Uri.joinPath(await this._lazySharedGKUri.value, relativeFilePath);
	}

	@debug()
	async acquireSharedStorageWriteLock(): Promise<UnifiedAsyncDisposable | undefined> {
		const scope = getScopedLogger();

		const lockFileUri = await this.getUri('lockfile');

		let stat;
		while (true) {
			try {
				stat = await workspace.fs.stat(lockFileUri);
			} catch {
				// File does not exist, so we can safely create it
				break;
			}

			const currentTime = Date.now();
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

	@debug()
	async releaseSharedStorageWriteLock(): Promise<boolean> {
		const scope = getScopedLogger();

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
