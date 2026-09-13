import type { GitCommit } from '@gitlens/git/models/commit.js';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import { filterMap, map } from '@gitlens/utils/iterable.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import type { Autolink } from '../../../autolinks/models/autolinks.js';
import type { Container } from '../../../container.js';
import type {
	AIGenerateChangelogChange,
	AIGenerateChangelogChanges,
} from '../../../plus/ai/actions/generateChangelog.js';
import { getBestRemoteWithIntegration } from './remote.utils.js';

export async function getChangesForChangelog(
	container: Container,
	range: AIGenerateChangelogChanges['range'],
	commits: readonly GitCommit[],
): Promise<AIGenerateChangelogChanges> {
	interface Change extends AIGenerateChangelogChange {
		links: Map<string, Autolink>;
	}

	const changes: Change[] = [];
	if (!commits.length) return { changes: changes, range: range };

	const allLinks: Map<string, Autolink> = new Map();

	const remote = await getBestRemoteWithIntegration(commits[0].repoPath);
	for (const commit of commits) {
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
				if (issueOrPR?.type !== 'issue') return undefined;

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
