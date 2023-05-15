import os from 'os';
import path from 'path';
import { Uri, workspace } from 'vscode';
import { localGKSharedDataFolder } from '../../../constants';
import { Logger } from '../../../system/logger';

export async function acquireSharedFolderWriteLock(): Promise<boolean> {
	const lockFilePath = path.join(os.homedir(), localGKSharedDataFolder, 'lockfile');
	let existingLockFileData;
	while (true) {
		try {
			existingLockFileData = await workspace.fs.readFile(Uri.file(lockFilePath));
		} catch (error) {
			// File does not exist, so we can safely create it
			break;
		}

		const existingLockFileTimestamp = parseInt(existingLockFileData.toString());
		if (isNaN(existingLockFileTimestamp)) {
			// File exists, but the timestamp is invalid, so we can safely remove it
			break;
		}

		const currentTime = new Date().getTime();
		if (currentTime - existingLockFileTimestamp > 30000) {
			// File exists, but the timestamp is older than 30 seconds, so we can safely remove it
			break;
		}

		// File exists, and the timestamp is less than 30 seconds old, so we need to wait for it to be removed
		await new Promise(resolve => setTimeout(resolve, 100));
	}

	// Create the lockfile with the current timestamp
	const lockFileData = new Uint8Array(Buffer.from(new Date().getTime().toString()));

	try {
		// write the lockfile to the shared data folder
		await workspace.fs.writeFile(Uri.file(lockFilePath), lockFileData);
	} catch (error) {
		Logger.error(error, 'acquireSharedFolderWriteLock');
		return false;
	}

	return true;
}

export async function releaseSharedFolderWriteLock(): Promise<boolean> {
	const lockFilePath = path.join(os.homedir(), localGKSharedDataFolder, 'lockfile');
	try {
		await workspace.fs.delete(Uri.file(lockFilePath));
	} catch (error) {
		Logger.error(error, 'releaseSharedFolderWriteLock');
		return false;
	}

	return true;
}
