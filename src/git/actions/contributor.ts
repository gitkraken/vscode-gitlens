import { Container } from '../../container';
import { executeGitCommand } from '../actions';
import type { GitContributor } from '../models/contributor';
import type { Repository } from '../models/repository';

export function addAuthors(repo?: string | Repository, contributors?: GitContributor | GitContributor[]) {
	return executeGitCommand({
		command: 'co-authors',
		state: { repo: repo, contributors: contributors },
	});
}

export function reveal(
	contributor: GitContributor,
	options?: {
		select?: boolean;
		focus?: boolean;
		expand?: boolean | number;
	},
) {
	return Container.instance.views.revealContributor(contributor, options);
}
