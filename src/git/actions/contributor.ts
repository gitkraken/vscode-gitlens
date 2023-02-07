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

export async function reveal(
	contributor: GitContributor,
	options?: {
		select?: boolean;
		focus?: boolean;
		expand?: boolean | number;
	},
) {
	const view = Container.instance.contributorsView;
	const node = view.canReveal
		? await view.revealContributor(contributor, options)
		: await Container.instance.repositoriesView.revealContributor(contributor, options);
	if (node == null) {
		void view.show({ preserveFocus: !options?.focus });
	}
	return node;
}
