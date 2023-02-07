import type { Uri } from 'vscode';
import { CoreCommands } from '../../constants';
import { Container } from '../../container';
import { ensure } from '../../system/array';
import { executeCoreCommand } from '../../system/command';
import type { OpenWorkspaceLocation} from '../../system/utils';
import { openWorkspace } from '../../system/utils';
import { executeGitCommand } from '../actions';
import type { GitReference } from '../models/reference';
import type { Repository } from '../models/repository';
import type { GitWorktree } from '../models/worktree';

export function create(repo?: string | Repository, uri?: Uri, ref?: GitReference, options?: { reveal?: boolean }) {
	return executeGitCommand({
		command: 'worktree',
		state: { subcommand: 'create', repo: repo, uri: uri, reference: ref, reveal: options?.reveal },
	});
}

export function open(worktree: GitWorktree, options?: { location?: OpenWorkspaceLocation }) {
	return openWorkspace(worktree.uri, options);
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
	void (await executeCoreCommand(CoreCommands.RevealInFileExplorer, worktree.uri));
}
