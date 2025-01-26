import type { Uri } from 'vscode';
import type { UnifiedAsyncDisposable } from '../../system/unifiedDisposable';

export interface SharedGkStorageLocationProvider {
	getSharedRepositoryLocationFileUri(): Promise<Uri>;
	getSharedCloudWorkspaceMappingFileUri(): Promise<Uri>;
	getSharedLocalWorkspaceMappingFileUri(): Promise<Uri>;

	acquireSharedStorageWriteLock(): Promise<UnifiedAsyncDisposable | undefined>;
	releaseSharedStorageWriteLock(): Promise<boolean>;
}
