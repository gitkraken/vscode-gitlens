import type { GitDiffShortStat } from '@gitlens/git/models/diff.js';
import type { GitFile } from '@gitlens/git/models/file.js';
import type { GitLog } from '@gitlens/git/models/log.js';
import type { GitUser } from '@gitlens/git/models/user.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { Container } from '../container.js';
import type { FilesQueryFilter } from '../views/nodes/resultsFilesNode.js';

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
		compareWithWorkingTree ? svc.diff.getDiffStatus('HEAD', undefined, { includeUntracked: true }) : undefined,
		compareWithWorkingTree
			? svc.diff.getChangedFilesCount('HEAD', undefined, { includeUntracked: true })
			: undefined,
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
			// When untracked files contributed to the working-tree stat, additions/deletions
			// undercount them — mark the stat approximated so consumers can render accordingly.
			const hasUntracked = files.some(f => f.status === '?');
			if (stats == null) {
				stats = hasUntracked ? { ...workingStats, approximated: true } : workingStats;
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

	const includeUntracked = ref1 === '';
	const [filesResult, statsResult] = await Promise.allSettled([
		svc.diff.getDiffStatus(comparison, undefined, { includeUntracked: includeUntracked }),
		// For the working-tree branch, pass `('', comparison)` so `prepareToFromDiffArgs` routes
		// through its `to === ''` branch and runs `git diff --shortstat <comparison>`
		// (working tree vs comparison). Passing `(comparison, undefined)` would synthesize
		// `<comparison>^ <comparison>` and return the commit's own delta instead.
		includeUntracked
			? svc.diff.getChangedFilesCount('', comparison, { includeUntracked: true })
			: svc.diff.getChangedFilesCount(comparison),
	]);

	const files = getSettledValue(filesResult) ?? [];
	let stats: FilesQueryResults['stats'] = getSettledValue(statsResult);
	if (includeUntracked && stats != null && files.some(f => f.status === '?')) {
		stats = { ...stats, approximated: true };
	}
	return {
		label: `${pluralize('file', files.length, { zero: 'No' })} changed`,
		files: files,
		stats: stats,
	};
}
