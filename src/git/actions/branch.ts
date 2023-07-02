import { Container } from '../../container';
import { executeGitCommand } from '../actions';
import type { GitBranchReference, GitReference } from '../models/reference';
import type { Repository } from '../models/repository';

export function create(repo?: string | Repository, ref?: GitReference, name?: string) {
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

export function remove(repo?: string | Repository, refs?: GitBranchReference | GitBranchReference[]) {
	return executeGitCommand({
		command: 'branch',
		state: {
			subcommand: 'delete',
			repo: repo,
			references: refs,
		},
	});
}

export function rename(repo?: string | Repository, ref?: GitBranchReference, name?: string) {
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

export async function reveal(
	branch: GitBranchReference,
	options?: {
		select?: boolean;
		focus?: boolean;
		expand?: boolean | number;
	},
) {
	const view = branch.remote ? Container.instance.remotesView : Container.instance.branchesView;
	const node = view.canReveal
		? await view.revealBranch(branch, options)
		: await Container.instance.repositoriesView.revealBranch(branch, options);

	if (node == null) {
		void view.show({ preserveFocus: !options?.focus });
	}
	return node;
}
