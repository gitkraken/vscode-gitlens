import type { Disposable } from 'vscode';
import { workspace } from 'vscode';
import type { Container } from '../../../container.js';
import type {
	RepositoryLocationEntry,
	RepositoryLocationProvider,
} from '../../../git/location/repositorylocationProvider.js';
import type { LocalRepoDataMap } from '../../../git/models/pathMapping.js';
import type { SharedGkStorageLocationProvider } from '../../../plus/repos/sharedGkStorageLocationProvider.js';
import { debug, trace } from '../../../system/decorators/log.js';
import { getScopedLogger } from '../../../system/logger.scope.js';

export class LocalRepositoryLocationProvider implements RepositoryLocationProvider, Disposable {
	constructor(
		private readonly container: Container,
		private readonly sharedStorage: SharedGkStorageLocationProvider,
	) {}

	dispose(): void {}

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

	@debug()
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

	@trace()
	private async loadLocalRepoDataMap() {
		const scope = getScopedLogger();

		const localFileUri = await this.sharedStorage.getSharedRepositoryLocationFileUri();
		try {
			const data = await workspace.fs.readFile(localFileUri);
			this._localRepoDataMap = (JSON.parse(data.toString()) ?? {}) as LocalRepoDataMap;
		} catch (ex) {
			scope?.error(ex);
		}
	}

	@debug()
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

	@debug({ args: entries => ({ entries: entries.length }) })
	async storeLocations(entries: RepositoryLocationEntry[]): Promise<void> {
		if (!entries.length) return;

		const scope = getScopedLogger();

		await using lock = await this.sharedStorage.acquireSharedStorageWriteLock();
		if (lock == null) return;

		await this.loadLocalRepoDataMap();
		this._localRepoDataMap ??= {};

		// Apply all updates to the in-memory map
		for (const entry of entries) {
			const { path, remoteUrl, repoInfo } = entry;
			if (!path) continue;

			// Store by remoteUrl if present
			if (remoteUrl) {
				this.updateMapEntry(remoteUrl, path);
			}

			// Store by provider/owner/repoName if present
			if (repoInfo?.provider != null && repoInfo?.owner != null && repoInfo?.repoName != null) {
				const key = `${repoInfo.provider}/${repoInfo.owner}/${repoInfo.repoName}`;
				this.updateMapEntry(key, path);
			}
		}

		// Write the file once with all updates
		const localFileUri = await this.sharedStorage.getSharedRepositoryLocationFileUri();
		const outputData = new Uint8Array(Buffer.from(JSON.stringify(this._localRepoDataMap)));
		try {
			await workspace.fs.writeFile(localFileUri, outputData);
		} catch (ex) {
			scope?.error(ex);
		}
	}

	@trace()
	private async storeLocationCore(key: string, path: string): Promise<void> {
		if (!key || !path) return;

		const scope = getScopedLogger();

		await using lock = await this.sharedStorage.acquireSharedStorageWriteLock();
		if (lock == null) return;

		await this.loadLocalRepoDataMap();
		this._localRepoDataMap ??= {};

		this.updateMapEntry(key, path);

		const localFileUri = await this.sharedStorage.getSharedRepositoryLocationFileUri();
		const outputData = new Uint8Array(Buffer.from(JSON.stringify(this._localRepoDataMap)));
		try {
			await workspace.fs.writeFile(localFileUri, outputData);
		} catch (ex) {
			scope?.error(ex);
		}
	}

	private updateMapEntry(key: string, path: string): void {
		if (!key || !path) return;

		this._localRepoDataMap ??= {};

		if (this._localRepoDataMap[key] == null) {
			this._localRepoDataMap[key] = { paths: [path] };
		} else if (this._localRepoDataMap[key].paths == null) {
			this._localRepoDataMap[key].paths = [path];
		} else if (!this._localRepoDataMap[key].paths.includes(path)) {
			this._localRepoDataMap[key].paths.push(path);
		}
	}
}
