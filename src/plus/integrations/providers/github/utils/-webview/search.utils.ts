import type { SearchOperators, SearchQuery } from '../../../../../../constants.search';
import type { GitUser } from '../../../../../../git/models/user';
import { map } from '../../../../../../system/iterable';
import type { GitHubGitProviderInternal } from '../../githubGitProvider';

const doubleQuoteRegex = /"/g;

export async function getQueryArgsFromSearchQuery(
	provider: GitHubGitProviderInternal,
	search: SearchQuery,
	operations: Map<SearchOperators, Set<string>>,
	repoPath: string,
) {
	const query = [];

	for (const [op, values] of operations.entries()) {
		switch (op) {
			case 'message:':
				query.push(...map(values, m => m.replace(/ /g, '+')));
				break;

			case 'author:': {
				let currentUser: GitUser | undefined;
				if (values.has('@me')) {
					currentUser = await provider.getCurrentUser(repoPath);
				}

				for (let value of values) {
					if (!value) continue;
					value = value.replace(doubleQuoteRegex, search.matchRegex ? '\\b' : '');
					if (!value) continue;

					if (value === '@me') {
						if (currentUser?.username == null) continue;

						value = `@${currentUser.username}`;
					}

					value = value.replace(/ /g, '+');
					if (value.startsWith('@')) {
						query.push(`author:${value.slice(1)}`);
					} else if (value.includes('@')) {
						query.push(`author-email:${value}`);
					} else {
						query.push(`author-name:${value}`);
					}
				}

				break;
			}
			// case 'change:':
			// case 'file:':
			// 	break;
		}
	}

	return query;
}
