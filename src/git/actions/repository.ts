import { Container } from '../../container';
import type { ViewNode } from '../../views/nodes/abstract/viewNode';
import type { RevealOptions, ViewsWithRepositoryFolders } from '../../views/viewBase';
import { executeGitCommand } from '../actions';
import type { GitBranchReference, GitReference, GitRevisionReference, GitTagReference } from '../models/reference';
import type { Repository } from '../models/repository';

export function cherryPick(
	repo?: string | Repository,
	refs?: GitRevisionReference | GitRevisionReference[],
): Promise<void> {
	return executeGitCommand({
		command: 'cherry-pick',
		state: { repo: repo, references: refs },
	});
}

export function fetch(repos?: string | string[] | Repository | Repository[], ref?: GitBranchReference): Promise<void> {
	return executeGitCommand({ command: 'fetch', state: { repos: repos, reference: ref } });
}

export function merge(repo?: string | Repository, ref?: GitReference): Promise<void> {
	return executeGitCommand({ command: 'merge', state: { repo: repo, reference: ref } });
}

export function pull(repos?: string | string[] | Repository | Repository[], ref?: GitBranchReference): Promise<void> {
	return executeGitCommand({ command: 'pull', state: { repos: repos, reference: ref } });
}

export function push(
	repos?: string | string[] | Repository | Repository[],
	force?: boolean,
	ref?: GitReference,
): Promise<void> {
	return executeGitCommand({
		command: 'push',
		state: { repos: repos, flags: force ? ['--force'] : [], reference: ref },
	});
}

export function rebase(repo?: string | Repository, ref?: GitReference, interactive: boolean = true): Promise<void> {
	return executeGitCommand({
		command: 'rebase',
		state: { repo: repo, destination: ref, flags: interactive ? ['--interactive'] : [] },
	});
}

export function reset(
	repo?: string | Repository,
	ref?: GitRevisionReference | GitTagReference,
	options?: { hard?: boolean; soft?: never } | { hard?: never; soft?: boolean },
): Promise<void> {
	const flags: Array<'--hard' | '--soft'> = [];
	if (options?.hard) {
		flags.push('--hard');
	} else if (options?.soft) {
		flags.push('--soft');
	}

	return executeGitCommand({
		command: 'reset',
		confirm: options == null || options.hard,
		state: { repo: repo, reference: ref, flags: flags },
	});
}

export function revert(
	repo?: string | Repository,
	refs?: GitRevisionReference | GitRevisionReference[],
): Promise<void> {
	return executeGitCommand({
		command: 'revert',
		state: { repo: repo, references: refs },
	});
}

export function switchTo(
	repos?: string | string[] | Repository | Repository[],
	ref?: GitReference,
	confirm?: boolean,
): Promise<void> {
	return executeGitCommand({
		command: 'switch',
		state: { repos: repos, reference: ref },
		confirm: confirm,
	});
}

export function revealRepository(
	repoPath: string,
	view?: ViewsWithRepositoryFolders,
	options?: RevealOptions,
): Promise<ViewNode | undefined> {
	return Container.instance.views.revealRepository(repoPath, view, options);
}
