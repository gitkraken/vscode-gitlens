import { join as joinPaths } from 'path';
import * as process from 'process';
import { maybeStopWatch } from '../../../system/stopwatch.js';
import { findExecutable, run } from '../git/shell.js';

export class UnableToFindMergeMateError extends Error {
	constructor(public readonly original?: Error) {
		super('Unable to find merge-mate');

		Error.captureStackTrace?.(this, new.target);
	}
}

export interface MergeMateLocation {
	path: string;
	version: string;
}

async function findSpecificMergeMate(path: string): Promise<MergeMateLocation> {
	const sw = maybeStopWatch(`findSpecificMergeMate(path=${path})`, {
		log: { level: 'debug', onlyExit: true },
		scopeLabel: 'MergeMate',
	});

	let version: string;
	try {
		version = await run(path, ['--version'], 'utf8');
	} catch (ex) {
		sw?.stop({ message: `\u2022 Unable to find merge-mate: ${ex}` });
		throw new UnableToFindMergeMateError(ex);
	}

	// If needed, resolve the full path
	if (!path || path === 'merge-mate') {
		try {
			const foundPath = (await findExecutable(path, ['--version'])).cmd;

			// Verify the resolved path works
			version = await run(foundPath, ['--version'], 'utf8');
			path = foundPath;
		} catch (ex) {
			sw?.stop({ message: `\u2022 Unable to resolve merge-mate path: ${ex}` });
			throw new UnableToFindMergeMateError(ex);
		}
	}

	const parsed = version.trim();

	sw?.stop({ message: `\u2022 Found merge-mate ${parsed} at ${path}` });

	return { path: path, version: parsed };
}

function findMergeMateWin32(): Promise<MergeMateLocation> {
	const programFiles = process.env['ProgramFiles'];
	if (programFiles) {
		return findSpecificMergeMate(joinPaths(programFiles, 'GitKraken', 'merge-mate.exe')).catch(() =>
			findSpecificMergeMate('merge-mate'),
		);
	}
	return findSpecificMergeMate('merge-mate');
}

export async function findMergeMatePath(configuredPath: string | null | undefined): Promise<MergeMateLocation> {
	try {
		if (configuredPath) {
			return await findSpecificMergeMate(configuredPath);
		}

		return await findSpecificMergeMate('merge-mate');
	} catch (ex) {
		// Platform-specific fallback search
		try {
			if (process.platform === 'win32') {
				return await findMergeMateWin32();
			}
			throw ex;
		} catch (ex) {
			throw ex instanceof UnableToFindMergeMateError ? ex : new UnableToFindMergeMateError(ex);
		}
	}
}
