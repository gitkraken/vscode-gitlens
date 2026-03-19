import type { Uri } from 'vscode';
import type { UnifiedAsyncDisposable } from '@gitlens/utils/disposable.js';

export interface SharedGkStorageLocationProvider {
	getSharedRepositoryLocationFileUri(): Promise<Uri>;
	getSharedCloudWorkspaceMappingFileUri(): Promise<Uri>;
	getSharedLocalWorkspaceMappingFileUri(): Promise<Uri>;

	acquireSharedStorageWriteLock(): Promise<UnifiedAsyncDisposable | undefined>;
	releaseSharedStorageWriteLock(): Promise<boolean>;
}
