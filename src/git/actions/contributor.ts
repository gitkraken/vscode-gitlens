import { Container } from '../../container';
import type { ViewNode } from '../../views/nodes/abstract/viewNode';
import { executeGitCommand } from '../actions';
import type { GitContributor } from '../models/contributor';
import type { Repository } from '../models/repository';

export function addAuthors(
	repo?: string | Repository,
	contributors?: GitContributor | GitContributor[],
): Promise<void> {
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
): Promise<ViewNode | undefined> {
	return Container.instance.views.revealContributor(contributor, options);
}
