import { Container } from '../../container';
import type { ViewNode } from '../../views/nodes/abstract/viewNode';
import { executeGitCommand } from '../actions';
import type { GitBranchReference, GitReference } from '../models/reference';
import type { Repository } from '../models/repository';

export function create(repo?: string | Repository, ref?: GitReference, name?: string): Promise<void> {
	return executeGitCommand({
		command: 'branch',
		state: {
			subcommand: 'create',
			repo: repo,
			reference: ref,
			name: name,
		},
	});
}

export function remove(repo?: string | Repository, refs?: GitBranchReference | GitBranchReference[]): Promise<void> {
	return executeGitCommand({
		command: 'branch',
		state: {
			subcommand: 'delete',
			repo: repo,
			references: refs,
		},
	});
}

export function rename(repo?: string | Repository, ref?: GitBranchReference, name?: string): Promise<void> {
	return executeGitCommand({
		command: 'branch',
		state: {
			subcommand: 'rename',
			repo: repo,
			reference: ref,
			name: name,
		},
	});
}

export function reveal(
	branch: GitBranchReference,
	options?: {
		select?: boolean;
		focus?: boolean;
		expand?: boolean | number;
	},
): Promise<ViewNode | undefined> {
	return Container.instance.views.revealBranch(branch, options);
}
