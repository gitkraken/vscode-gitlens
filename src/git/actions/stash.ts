import type { Uri } from 'vscode';
import { Container } from '../../container';
import { executeGitCommand } from '../actions';
import type { GitStashCommit } from '../models/commit';
import type { GitStashReference } from '../models/reference';
import type { Repository } from '../models/repository';

export function apply(repo?: string | Repository, ref?: GitStashReference) {
	return executeGitCommand({
		command: 'stash',
		state: { subcommand: 'apply', repo: repo, reference: ref },
	});
}

export function drop(repo?: string | Repository, ref?: GitStashReference) {
	return executeGitCommand({
		command: 'stash',
		state: { subcommand: 'drop', repo: repo, reference: ref },
	});
}

export function pop(repo?: string | Repository, ref?: GitStashReference) {
	return executeGitCommand({
		command: 'stash',
		state: { subcommand: 'pop', repo: repo, reference: ref },
	});
}

export function push(repo?: string | Repository, uris?: Uri[], message?: string, keepStaged: boolean = false) {
	return executeGitCommand({
		command: 'stash',
		state: {
			subcommand: 'push',
			repo: repo,
			uris: uris,
			message: message,
			flags: keepStaged ? ['--keep-index'] : undefined,
		},
	});
}

export async function reveal(
	stash: GitStashReference,
	options?: {
		select?: boolean;
		focus?: boolean;
		expand?: boolean | number;
	},
) {
	const view = Container.instance.stashesView;
	const node = view.canReveal
		? await view.revealStash(stash, options)
		: await Container.instance.repositoriesView.revealStash(stash, options);
	if (node == null) {
		void view.show({ preserveFocus: !options?.focus });
	}
	return node;
}

export function showDetailsView(
	stash: GitStashReference | GitStashCommit,
	options?: { pin?: boolean; preserveFocus?: boolean },
): Promise<void> {
	return Container.instance.commitDetailsView.show({ ...options, commit: stash });
}
