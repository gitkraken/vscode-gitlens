import type { ResetGitCommandArgs } from '../../commands/git/reset';
import { Container } from '../../container';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase';
import { executeGitCommand } from '../actions';
import type { GitBranchReference, GitReference, GitRevisionReference } from '../models/reference';
import type { Repository } from '../models/repository';

export function cherryPick(repo?: string | Repository, refs?: GitRevisionReference | GitRevisionReference[]) {
	return executeGitCommand({
		command: 'cherry-pick',
		state: { repo: repo, references: refs },
	});
}

export function fetch(repos?: string | string[] | Repository | Repository[], ref?: GitBranchReference) {
	return executeGitCommand({ command: 'fetch', state: { repos: repos, reference: ref } });
}

export function merge(repo?: string | Repository, ref?: GitReference) {
	return executeGitCommand({ command: 'merge', state: { repo: repo, reference: ref } });
}

export function pull(repos?: string | string[] | Repository | Repository[], ref?: GitBranchReference) {
	return executeGitCommand({ command: 'pull', state: { repos: repos, reference: ref } });
}

export function push(repos?: string | string[] | Repository | Repository[], force?: boolean, ref?: GitReference) {
	return executeGitCommand({
		command: 'push',
		state: { repos: repos, flags: force ? ['--force'] : [], reference: ref },
	});
}

export function rebase(repo?: string | Repository, ref?: GitReference, interactive: boolean = true) {
	return executeGitCommand({
		command: 'rebase',
		state: { repo: repo, reference: ref, flags: interactive ? ['--interactive'] : [] },
	});
}

export function reset(
	repo?: string | Repository,
	ref?: GitRevisionReference,
	flags?: NonNullable<ResetGitCommandArgs['state']>['flags'],
) {
	return executeGitCommand({
		command: 'reset',
		confirm: flags == null || flags.includes('--hard'),
		state: { repo: repo, reference: ref, flags: flags },
	});
}

export function revert(repo?: string | Repository, refs?: GitRevisionReference | GitRevisionReference[]) {
	return executeGitCommand({
		command: 'revert',
		state: { repo: repo, references: refs },
	});
}

export function switchTo(repos?: string | string[] | Repository | Repository[], ref?: GitReference, confirm?: boolean) {
	return executeGitCommand({
		command: 'switch',
		state: { repos: repos, reference: ref },
		confirm: confirm,
	});
}

export async function reveal(
	repoPath: string,
	view?: ViewsWithRepositoryFolders,
	options?: {
		select?: boolean;
		focus?: boolean;
		expand?: boolean | number;
	},
) {
	const node = view?.canReveal
		? await view.revealRepository(repoPath, options)
		: await Container.instance.repositoriesView.revealRepository(repoPath, options);
	if (node == null) {
		void (view ?? Container.instance.repositoriesView).show({ preserveFocus: !options?.focus });
	}
	return node;
}
