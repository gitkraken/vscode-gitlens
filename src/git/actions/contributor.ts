import { Container } from '../../container';
import type { ViewNode } from '../../views/nodes/abstract/viewNode';
import type { RevealOptions } from '../../views/viewBase';
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

export function revealContributor(contributor: GitContributor, options?: RevealOptions): Promise<ViewNode | undefined> {
	return Container.instance.views.revealContributor(contributor, options);
}
