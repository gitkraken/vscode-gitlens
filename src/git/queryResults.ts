import type { Container } from '../container';
import { getSettledValue } from '../system/promise';
import { pluralize } from '../system/string';
import type { FilesQueryFilter } from '../views/nodes/resultsFilesNode';
import type { GitDiffShortStat } from './models/diff';
import type { GitFile } from './models/file';
import type { GitLog } from './models/log';
import type { GitUser } from './models/user';

export interface CommitsQueryResults {
	readonly label?: string;
	readonly log: GitLog | undefined;
	readonly hasMore: boolean;
	more?(limit: number | undefined): Promise<void>;
}

export interface FilesQueryResults {
	label: string;
	files: GitFile[] | undefined;
	stats?: (GitDiffShortStat & { approximated?: boolean }) | undefined;

	filtered?: Map<FilesQueryFilter, GitFile[]>;
}

export async function getAheadBehindFilesQuery(
	container: Container,
	repoPath: string,
	comparison: string,
	compareWithWorkingTree: boolean,
): Promise<FilesQueryResults> {
	const svc = container.git.getRepositoryService(repoPath);

	const [filesResult, statsResult, workingFilesResult, workingStatsResult] = await Promise.allSettled([
		svc.diff.getDiffStatus(comparison),
		svc.diff.getChangedFilesCount(comparison),
		compareWithWorkingTree ? svc.diff.getDiffStatus('HEAD') : undefined,
		compareWithWorkingTree ? svc.diff.getChangedFilesCount('HEAD') : undefined,
	]);

	let files = getSettledValue(filesResult) ?? [];
	let stats: FilesQueryResults['stats'] = getSettledValue(statsResult);

	if (compareWithWorkingTree) {
		const workingFiles = getSettledValue(workingFilesResult);
		if (workingFiles != null) {
			if (!files.length) {
				files = workingFiles ?? [];
			} else {
				for (const wf of workingFiles) {
					const index = files.findIndex(f => f.path === wf.path);
					if (index !== -1) {
						files.splice(index, 1, wf);
					} else {
						files.push(wf);
					}
				}
			}
		}

		const workingStats = getSettledValue(workingStatsResult);
		if (workingStats != null) {
			if (stats == null) {
				stats = workingStats;
			} else {
				stats = {
					additions: stats.additions + workingStats.additions,
					deletions: stats.deletions + workingStats.deletions,
					files: files.length,
					approximated: true,
				};
			}
		}
	}

	return {
		label: `${pluralize('file', files.length, { zero: 'No' })} changed`,
		files: files,
		stats: stats,
	};
}

export function getCommitsQuery(
	container: Container,
	repoPath: string,
	range: string,
	filterByAuthors?: GitUser[] | undefined,
): (limit: number | undefined) => Promise<CommitsQueryResults> {
	const svc = container.git.getRepositoryService(repoPath);

	return async (limit: number | undefined) => {
		const log = await svc.commits.getLog(range, { limit: limit, authors: filterByAuthors });

		const results: Mutable<CommitsQueryResults> = {
			log: log,
			hasMore: log?.hasMore ?? true,
		};
		if (results.hasMore) {
			results.more = async (limit: number | undefined) => {
				results.log = (await results.log?.more?.(limit)) ?? results.log;
				results.hasMore = results.log?.hasMore ?? true;
			};
		}

		return results satisfies CommitsQueryResults;
	};
}

export async function getFilesQuery(
	container: Container,
	repoPath: string,
	ref1: string,
	ref2: string,
): Promise<FilesQueryResults> {
	let comparison;
	if (ref2 === '') {
		debugger;
		throw new Error('Cannot get files for comparisons of a ref with working tree');
	} else if (ref1 === '') {
		comparison = ref2;
	} else {
		comparison = `${ref2}..${ref1}`;
	}

	const svc = container.git.getRepositoryService(repoPath);

	const [filesResult, statsResult] = await Promise.allSettled([
		svc.diff.getDiffStatus(comparison),
		ref1 === '' ? svc.diff.getChangedFilesCount('', comparison) : svc.diff.getChangedFilesCount(comparison),
	]);

	const files = getSettledValue(filesResult) ?? [];
	return {
		label: `${pluralize('file', files.length, { zero: 'No' })} changed`,
		files: files,
		stats: getSettledValue(statsResult),
	};
}
