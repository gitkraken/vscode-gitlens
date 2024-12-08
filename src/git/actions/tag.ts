import { Container } from '../../container';
import { executeGitCommand } from '../actions';
import type { GitReference, GitTagReference } from '../models/reference';
import type { Repository } from '../models/repository';

export function create(repo?: string | Repository, ref?: GitReference, name?: string) {
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

export function remove(repo?: string | Repository, refs?: GitTagReference | GitTagReference[]) {
	return executeGitCommand({
		command: 'tag',
		state: {
			subcommand: 'delete',
			repo: repo,
			references: refs,
		},
	});
}

export function reveal(
	tag: GitTagReference,
	options?: {
		select?: boolean;
		focus?: boolean;
		expand?: boolean | number;
	},
) {
	return Container.instance.views.revealTag(tag, options);
}
