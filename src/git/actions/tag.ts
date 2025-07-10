import { Container } from '../../container';
import type { ViewNode } from '../../views/nodes/abstract/viewNode';
import type { RevealOptions } from '../../views/viewBase';
import { executeGitCommand } from '../actions';
import type { GitReference, GitTagReference } from '../models/reference';
import type { Repository } from '../models/repository';

export function create(repo?: string | Repository, ref?: GitReference, name?: string): Promise<void> {
	return executeGitCommand({
		command: 'tag',
		state: {
			subcommand: 'create',
			repo: repo,
			reference: ref,
			name: name,
		},
	});
}

export function remove(repo?: string | Repository, refs?: GitTagReference | GitTagReference[]): Promise<void> {
	return executeGitCommand({
		command: 'tag',
		state: {
			subcommand: 'delete',
			repo: repo,
			references: refs,
		},
	});
}

export function revealTag(tag: GitTagReference, options?: RevealOptions): Promise<ViewNode | undefined> {
	return Container.instance.views.revealTag(tag, options);
}
