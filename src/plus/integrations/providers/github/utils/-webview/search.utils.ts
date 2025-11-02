import type { SearchOperators, SearchQuery } from '../../../../../../constants.search';
import type { GitUser } from '../../../../../../git/models/user';
import type { GitHubGitProviderInternal } from '../../githubGitProvider';

export async function getQueryArgsFromSearchQuery(
	provider: GitHubGitProviderInternal,
	search: SearchQuery,
	operations: Map<SearchOperators, Set<string>>,
	repoPath: string,
): Promise<string[]> {
	const query = [];

	for (const [op, values] of operations.entries()) {
		switch (op) {
			case 'message:':
				for (let value of values) {
					if (!value) continue;

					if (value.startsWith('"') && value.endsWith('"')) {
						value = value.slice(1, -1);
						if (!value) continue;
					}

					if (search.matchWholeWord && search.matchRegex) {
						value = `\\b${value}\\b`;
					}

					query.push(value.replace(/ /g, '+'));
				}
				break;

			case 'author:': {
				let currentUser: GitUser | undefined;

				for (let value of values) {
					if (!value) continue;

					if (value.startsWith('"') && value.endsWith('"')) {
						value = value.slice(1, -1);
						if (!value) continue;
					}

					if (value === '@me') {
						currentUser ??= await provider.config.getCurrentUser(repoPath);
						if (!currentUser?.name) continue;

						value = `@${currentUser.username}`;
					}

					value = value.replace(/ /g, '+');
					if (value.startsWith('@')) {
						value = value.slice(1);
						query.push(`author:${value.slice(1)}`);
					} else if (value.includes('@')) {
						query.push(`author-email:${value}`);
					} else {
						query.push(`author-name:${value}`);
					}
				}

				break;
			}

			case 'type:':
			case 'file:':
			case 'change:':
			case 'ref:':
				// Not supported in GitHub search
				break;

			case 'after:':
			case 'before:': {
				const flag = op === 'after:' ? 'author-date:>' : 'author-date:<';

				for (let value of values) {
					if (!value) continue;

					if (value.startsWith('"') && value.endsWith('"')) {
						value = value.slice(1, -1);
						if (!value) continue;
					}

					// if value is YYYY-MM-DD then include it, otherwise we can't use it
					if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
						query.push(`${flag}${value}`);
					}
				}
				break;
			}
		}
	}

	return query;
}
