import type { Disposable } from 'vscode';
import { workspace } from 'vscode';
import type { Container } from '../../../container';
import type { RepositoryLocationProvider } from '../../../git/location/repositorylocationProvider';
import type { LocalRepoDataMap } from '../../../git/models/pathMapping';
import type { SharedGkStorageLocationProvider } from '../../../plus/repos/sharedGkStorageLocationProvider';
import { debug, log } from '../../../system/decorators/log';
import { Logger } from '../../../system/logger';
import { getLogScope } from '../../../system/logger.scope';

export class LocalRepositoryLocationProvider implements RepositoryLocationProvider, Disposable {
	constructor(
		private readonly container: Container,
		private readonly sharedStorage: SharedGkStorageLocationProvider,
	) {}

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

	@log()
	async getLocation(
		remoteUrl: string,
		repoInfo?: { provider?: string; owner?: string; repoName?: string },
	): Promise<string[]> {
		const paths: string[] = [];
		if (remoteUrl != null) {
			const remoteUrlPaths = await this._getLocalRepoPaths(remoteUrl);
			if (remoteUrlPaths != null) {
				paths.push(...remoteUrlPaths);
			}
		}
		if (repoInfo != null) {
			const { provider, owner, repoName } = repoInfo;
			if (provider != null && owner != null && repoName != null) {
				const repoInfoPaths = await this._getLocalRepoPaths(`${provider}/${owner}/${repoName}`);
				if (repoInfoPaths != null) {
					paths.push(...repoInfoPaths);
				}
			}
		}

		return paths;
	}

	private async _getLocalRepoPaths(key: string): Promise<string[] | undefined> {
		const localRepoDataMap = await this.getLocalRepoDataMap();
		return localRepoDataMap[key]?.paths;
	}

	@debug()
	private async loadLocalRepoDataMap() {
		const scope = getLogScope();

		const localFileUri = await this.sharedStorage.getSharedRepositoryLocationFileUri();
		try {
			const data = await workspace.fs.readFile(localFileUri);
			this._localRepoDataMap = (JSON.parse(data.toString()) ?? {}) as LocalRepoDataMap;
		} catch (ex) {
			Logger.error(ex, scope);
		}
	}

	@log()
	async storeLocation(
		path: string,
		remoteUrl: string | undefined,
		repoInfo?: { provider?: string; owner?: string; repoName?: string },
	): Promise<void> {
		if (remoteUrl != null) {
			await this.storeLocationCore(remoteUrl, path);
		}
		if (repoInfo?.provider != null && repoInfo?.owner != null && repoInfo?.repoName != null) {
			const { provider, owner, repoName } = repoInfo;
			const key = `${provider}/${owner}/${repoName}`;
			await this.storeLocationCore(key, path);
		}
	}

	@debug()
	private async storeLocationCore(key: string, path: string): Promise<void> {
		if (!key || !path) return;

		const scope = getLogScope();

		await using lock = await this.sharedStorage.acquireSharedStorageWriteLock();
		if (lock == null) return;

		await this.loadLocalRepoDataMap();
		if (this._localRepoDataMap == null) {
			this._localRepoDataMap = {};
		}

		if (this._localRepoDataMap[key] == null) {
			this._localRepoDataMap[key] = { paths: [path] };
		} else if (this._localRepoDataMap[key].paths == null) {
			this._localRepoDataMap[key].paths = [path];
		} else if (!this._localRepoDataMap[key].paths.includes(path)) {
			this._localRepoDataMap[key].paths.push(path);
		}

		const localFileUri = await this.sharedStorage.getSharedRepositoryLocationFileUri();
		const outputData = new Uint8Array(Buffer.from(JSON.stringify(this._localRepoDataMap)));
		try {
			await workspace.fs.writeFile(localFileUri, outputData);
		} catch (ex) {
			Logger.error(ex, scope);
		}
	}
}
