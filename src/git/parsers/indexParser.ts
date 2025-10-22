import { maybeStopWatch } from '../../system/stopwatch';
import { iterateByDelimiter } from '../../system/string';
import type { GitConflictFile, GitConflictRevision, GitIndexFile, GitIndexVersion } from '../models';
import { GitFileConflictStatus } from '../models/fileStatus';

export function parseGitLsFilesStaged(data: string | undefined, singleEntry: boolean): GitIndexFile[] {
	using sw = maybeStopWatch(`Git.parseLsFiles`, { log: false, logLevel: 'debug' });

	const files: GitIndexFile[] = [];
	if (!data) {
		sw?.stop({ suffix: ` no data` });
		return files;
	}

	// Format: <mode> <object> <stage>\t<file>\0
	// Using -z flag ensures filenames are NUL-delimited and not quoted

	let metadata: string;
	let mode: string;
	let oid: string;
	let stage: number;
	let path: string;

	let startIndex = 0;
	let endIndex = 0;
	let tabIndex = 0;

	// Avoid generator if we are only parsing a single entry
	for (const line of singleEntry ? data.split('\0') : iterateByDelimiter(data, '\0')) {
		if (!line) continue;

		// Split on tab to separate metadata from path
		tabIndex = line.indexOf('\t');
		if (tabIndex === -1) continue;

		metadata = line.substring(0, tabIndex);
		path = line.substring(tabIndex + 1);

		// Parse mode
		startIndex = 0;
		endIndex = metadata.indexOf(' ', startIndex);
		if (endIndex === -1) continue;

		mode = metadata.substring(startIndex, endIndex);

		// Parse oid
		startIndex = endIndex + 1;
		endIndex = metadata.indexOf(' ', startIndex);
		if (endIndex === -1) continue;

		oid = metadata.substring(startIndex, endIndex);

		// Parse stage
		startIndex = endIndex + 1;

		stage = parseInt(metadata.substring(startIndex), 10);

		files.push({ mode: mode, oid: oid, path: path, version: convertStageToVersion(isNaN(stage) ? 0 : stage) });
	}

	sw?.stop({ suffix: ` parsed ${files.length} files` });

	return files;
}

export function parseGitConflictFiles(data: string | undefined, repoPath: string): GitConflictFile[] {
	using sw = maybeStopWatch(`Git.parseConflictFiles`, { log: false, logLevel: 'debug' });

	if (!data) {
		sw?.stop({ suffix: ` no data` });
		return [];
	}

	// Format: <mode> <object> <stage>\t<file>\0
	// Using -z flag ensures filenames are NUL-delimited and not quoted

	const files = new Map<string, Mutable<GitConflictFile>>();

	let metadata: string;
	let mode: string;
	let oid: string;
	let stage: number;
	let path: string;
	let revision: GitConflictRevision;

	let startIndex = 0;
	let endIndex = 0;
	let tabIndex = 0;

	for (const line of iterateByDelimiter(data, '\0')) {
		if (!line) continue;

		tabIndex = line.indexOf('\t');
		if (tabIndex === -1) continue;

		metadata = line.substring(0, tabIndex);
		path = line.substring(tabIndex + 1);

		// Parse mode
		startIndex = 0;
		endIndex = metadata.indexOf(' ', startIndex);
		if (endIndex === -1) continue;

		mode = metadata.substring(startIndex, endIndex);

		// Parse oid
		startIndex = endIndex + 1;
		endIndex = metadata.indexOf(' ', startIndex);
		if (endIndex === -1) continue;

		oid = metadata.substring(startIndex, endIndex);

		// Parse stage
		startIndex = endIndex + 1;

		stage = parseInt(metadata.substring(startIndex), 10);

		revision = { mode: mode, oid: oid, version: convertStageToVersion(stage) };

		// Get or create file entry
		let file = files.get(path);
		if (!file) {
			file = {
				path: path,
				repoPath: repoPath,
				get status(): GitFileConflictStatus {
					const pattern =
						(this.base != null ? 4 : 0) | (this.current != null ? 2 : 0) | (this.incoming != null ? 1 : 0);

					switch (pattern) {
						case 0b001:
							return GitFileConflictStatus.AddedByThem; // UA
						case 0b010:
							return GitFileConflictStatus.AddedByUs; // AU
						case 0b011:
							return GitFileConflictStatus.AddedByBoth; // AA
						case 0b101:
							return GitFileConflictStatus.DeletedByUs; // DU
						case 0b110:
							return GitFileConflictStatus.DeletedByThem; // UD
						case 0b111:
							return GitFileConflictStatus.ModifiedByBoth; // UU
						default:
							return GitFileConflictStatus.DeletedByBoth; // DD (0b000, 0b100)
					}
				},
				get conflictStatus(): GitFileConflictStatus {
					return this.status;
				},
			};
			files.set(path, file);
		}

		// Assign revision appropriate version (stage)
		switch (stage) {
			case 1:
				file.base = revision;
				break;
			case 2:
				file.current = revision;
				break;
			case 3:
				file.incoming = revision;
				break;
		}
	}

	sw?.stop({ suffix: ` parsed ${files.size} conflict files` });

	return [...files.values()];
}

function convertStageToVersion(stage: number): GitIndexVersion | undefined {
	switch (stage) {
		case 0:
			return 'normal';
		case 1:
			return 'base';
		case 2:
			return 'current';
		case 3:
			return 'incoming';
		default:
			return undefined;
	}
}
