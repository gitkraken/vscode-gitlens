import type { Autolink } from '../../../autolinks/models/autolinks';
import type { Container } from '../../../container';
import type { AIGenerateChangelogChange, AIGenerateChangelogChanges } from '../../../plus/ai/aiProviderService';
import { filterMap, map } from '../../../system/iterable';
import { getSettledValue } from '../../../system/promise';
import type { IssueOrPullRequest } from '../../models/issueOrPullRequest';
import type { GitLog } from '../../models/log';

export async function getChangesForChangelog(
	container: Container,
	range: AIGenerateChangelogChanges['range'],
	log: GitLog,
): Promise<AIGenerateChangelogChanges> {
	interface Change extends AIGenerateChangelogChange {
		links: Map<string, Autolink>;
	}

	const changes: Change[] = [];
	if (!log.commits.size) return { changes: changes, range: range };

	const allLinks: Map<string, Autolink> = new Map();

	const remote = await container.git.remotes(log.repoPath).getBestRemoteWithIntegration();
	for (const commit of log.commits.values()) {
		const message = commit.message ?? commit.summary;
		const links = await container.autolinks.getAutolinks(message, remote);
		changes.push({ message: message, links: links, issues: [] });

		for (const [key, value] of links) {
			allLinks.set(key, value);
		}
	}

	let issues: Map<string, IssueOrPullRequest>;
	const enriched = await container.autolinks.getEnrichedAutolinks(allLinks, remote);
	if (enriched != null) {
		const issuesOrPullRequests = await Promise.allSettled(
			filterMap(enriched, async ([key, [issueOrPullRequest]]) => {
				const issueOrPR = await issueOrPullRequest;
				if (issueOrPR == null || issueOrPR.type !== 'issue') return undefined;

				return [key, issueOrPR] as const;
			}),
		);
		issues = new Map(filterMap(issuesOrPullRequests, r => getSettledValue(r)));
	} else {
		issues = new Map();
	}

	for (const change of changes) {
		(change.issues as Mutable<typeof change.issues>).push(
			...map(change.links, ([key, link]) => {
				const issue = issues.get(key);
				return {
					id: issue?.id ?? key,
					url: issue?.url ?? link.url,
					title: issue?.title,
				};
			}),
		);
	}

	return { changes: changes, range: range };
}
