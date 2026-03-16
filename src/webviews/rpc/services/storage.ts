/**
 * Storage service — typed access to workspace-scoped persistent storage.
 */

import type { WorkspaceStorage } from '../../../constants.storage.js';
import type { Container } from '../../../container.js';

export class StorageService {
	constructor(private readonly container: Container) {}

	/**
	 * Get a workspace storage value.
	 */
	getWorkspace<T extends keyof WorkspaceStorage>(key: T): Promise<WorkspaceStorage[T] | undefined> {
		return Promise.resolve(this.container.storage.getWorkspace(key));
	}

	/**
	 * Update a workspace storage value.
	 */
	async updateWorkspace<T extends keyof WorkspaceStorage>(
		key: T,
		value: WorkspaceStorage[T] | undefined,
	): Promise<void> {
		await this.container.storage.storeWorkspace(key, value);
	}
}
