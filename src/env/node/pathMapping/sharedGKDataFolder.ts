import os from 'os';
import path from 'path';
import { Uri, workspace } from 'vscode';
import { Logger } from '../../../system/logger';
import { wait } from '../../../system/promise';
import { getPlatform } from '../platform';

export const sharedGKDataFolder = '.gk';

export async function acquireSharedFolderWriteLock(): Promise<boolean> {
	const lockFileUri = getSharedLockFileUri();

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

export async function releaseSharedFolderWriteLock(): Promise<boolean> {
	try {
		const lockFileUri = getSharedLockFileUri();
		await workspace.fs.delete(lockFileUri);
	} catch (error) {
		Logger.error(error, 'releaseSharedFolderWriteLock');
		return false;
	}

	return true;
}

function getSharedLockFileUri() {
	return Uri.file(path.join(os.homedir(), sharedGKDataFolder, 'lockfile'));
}

export function getSharedRepositoryMappingFileUri() {
	return Uri.file(path.join(os.homedir(), sharedGKDataFolder, 'repoMapping.json'));
}

export function getSharedCloudWorkspaceMappingFileUri() {
	return Uri.file(path.join(os.homedir(), sharedGKDataFolder, 'cloudWorkspaces.json'));
}

export function getSharedLocalWorkspaceMappingFileUri() {
	return Uri.file(path.join(os.homedir(), sharedGKDataFolder, 'localWorkspaces.json'));
}

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
