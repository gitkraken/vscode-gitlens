import { formatDate, fromNow } from '../../system/date';
import { map } from '../../system/iterable';
import { configuration } from '../../system/vscode/configuration';
import type { Repository } from './repository';

export async function groupRepositories(repositories: Repository[]): Promise<Map<Repository, Map<string, Repository>>> {
	const repos = new Map<string, Repository>(repositories.map(r => [r.id, r]));

	// Group worktree repos under the common repo when the common repo is also in the list
	const result = new Map<string, { repo: Repository; worktrees: Map<string, Repository> }>();
	for (const [, repo] of repos) {
		let commonRepo = await repo.getCommonRepository();
		if (commonRepo == null) {
			if (result.has(repo.id)) {
				debugger;
			}
			result.set(repo.id, { repo: repo, worktrees: new Map() });
			continue;
		}

		commonRepo = repos.get(commonRepo.id);
		if (commonRepo == null) {
			if (result.has(repo.id)) {
				debugger;
			}
			result.set(repo.id, { repo: repo, worktrees: new Map() });
			continue;
		}

		let r = result.get(commonRepo.id);
		if (r == null) {
			r = { repo: commonRepo, worktrees: new Map() };
			result.set(commonRepo.id, r);
		} else {
			r.worktrees.set(repo.path, repo);
		}
	}

	return new Map(map(result, ([, r]) => [r.repo, r.worktrees]));
}

const millisecondsPerMinute = 60 * 1000;
const millisecondsPerHour = 60 * 60 * 1000;
const millisecondsPerDay = 24 * 60 * 60 * 1000;

export function formatLastFetched(lastFetched: number, short: boolean = true): string {
	const date = new Date(lastFetched);
	if (Date.now() - lastFetched < millisecondsPerDay) {
		return fromNow(date);
	}

	if (short) {
		return formatDate(date, configuration.get('defaultDateShortFormat') ?? 'short');
	}

	let format =
		configuration.get('defaultDateFormat') ??
		`dddd, MMMM Do, YYYY [at] ${configuration.get('defaultTimeFormat') ?? 'h:mma'}`;
	if (!/[hHm]/.test(format)) {
		format += ` [at] ${configuration.get('defaultTimeFormat') ?? 'h:mma'}`;
	}
	return formatDate(date, format);
}

export function getLastFetchedUpdateInterval(lastFetched: number): number {
	const timeDiff = Date.now() - lastFetched;
	return timeDiff < millisecondsPerDay
		? (timeDiff < millisecondsPerHour ? millisecondsPerMinute : millisecondsPerHour) / 2
		: 0;
}
