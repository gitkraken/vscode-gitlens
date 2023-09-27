import type { Uri } from 'vscode';
import type { WorktreeGitCommandArgs } from '../../commands/git/worktree';
import { Container } from '../../container';
import { ensure } from '../../system/array';
import { executeCoreCommand } from '../../system/command';
import type { OpenWorkspaceLocation } from '../../system/utils';
import { executeGitCommand } from '../actions';
import type { GitReference } from '../models/reference';
import type { Repository } from '../models/repository';
import type { GitWorktree } from '../models/worktree';

export function create(
	repo?: string | Repository,
	uri?: Uri,
	ref?: GitReference,
	options?: { createBranch?: string; reveal?: boolean },
) {
	return executeGitCommand({
		command: 'worktree',
		state: {
			subcommand: 'create',
			repo: repo,
			uri: uri,
			reference: ref,
			createBranch: options?.createBranch,
			flags: options?.createBranch ? ['-b'] : undefined,
			reveal: options?.reveal,
		},
	});
}

export function open(worktree: GitWorktree, options?: { location?: OpenWorkspaceLocation }) {
	return executeGitCommand({
		command: 'worktree',
		state: {
			subcommand: 'open',
			repo: worktree.repoPath,
			uri: worktree.uri,
			flags: convertLocationToOpenFlags(options?.location),
		},
	});
}

export function remove(repo?: string | Repository, uri?: Uri) {
	return executeGitCommand({
		command: 'worktree',
		state: { subcommand: 'delete', repo: repo, uris: ensure(uri) },
	});
}

export async function reveal(
	worktree: GitWorktree | undefined,
	options?: { select?: boolean; focus?: boolean; expand?: boolean | number },
) {
	const view = Container.instance.worktreesView;
	const node =
		worktree != null
			? view.canReveal
				? await view.revealWorktree(worktree, options)
				: await Container.instance.repositoriesView.revealWorktree(worktree, options)
			: undefined;
	if (node == null) {
		void view.show({ preserveFocus: !options?.focus });
	}
	return node;
}

export async function revealInFileExplorer(worktree: GitWorktree) {
	void (await executeCoreCommand('revealFileInOS', worktree.uri));
}

type OpenFlagsArray = Extract<NonNullable<Required<WorktreeGitCommandArgs['state']>>, { subcommand: 'open' }>['flags'];

export function convertLocationToOpenFlags(location: OpenWorkspaceLocation | undefined): OpenFlagsArray | undefined {
	if (location == null) return undefined;

	switch (location) {
		case 'newWindow':
			return ['--new-window'];
		case 'addToWorkspace':
			return ['--add-to-workspace'];
		case 'currentWindow':
		default:
			return [];
	}
}

export function convertOpenFlagsToLocation(flags: OpenFlagsArray | undefined): OpenWorkspaceLocation | undefined {
	if (flags == null) return undefined;

	if (flags.includes('--new-window')) return 'newWindow';
	if (flags.includes('--add-to-workspace')) return 'addToWorkspace';
	return 'currentWindow';
}
