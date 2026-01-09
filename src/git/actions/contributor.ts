import { Container } from '../../container.js';
import type { ViewNode } from '../../views/nodes/abstract/viewNode.js';
import type { RevealOptions } from '../../views/viewBase.js';
import { executeGitCommand } from '../actions.js';
import type { GitContributor } from '../models/contributor.js';
import type { Repository } from '../models/repository.js';

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
