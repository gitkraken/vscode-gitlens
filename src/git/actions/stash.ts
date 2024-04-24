import type { Uri } from 'vscode';
import type { PushFlags } from '../../commands/git/stash';
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

export function drop(repo?: string | Repository, refs?: GitStashReference[]) {
	return executeGitCommand({
		command: 'stash',
		state: { subcommand: 'drop', repo: repo, references: refs },
	});
}

export function rename(repo?: string | Repository, ref?: GitStashReference, message?: string) {
	return executeGitCommand({
		command: 'stash',
		state: { subcommand: 'rename', repo: repo, reference: ref, message: message },
	});
}

export function pop(repo?: string | Repository, ref?: GitStashReference) {
	return executeGitCommand({
		command: 'stash',
		state: { subcommand: 'pop', repo: repo, reference: ref },
	});
}

export function push(
	repo?: string | Repository,
	uris?: Uri[],
	message?: string,
	includeUntracked: boolean = false,
	keepStaged: boolean = false,
	onlyStaged: boolean = false,
	onlyStagedUris?: Uri[],
) {
	return executeGitCommand({
		command: 'stash',
		state: {
			subcommand: 'push',
			repo: repo,
			uris: uris,
			onlyStagedUris: onlyStagedUris,
			message: message,
			flags: [
				...(includeUntracked ? ['--include-untracked'] : []),
				...(keepStaged ? ['--keep-index'] : []),
				...(onlyStaged ? ['--staged'] : []),
			] as PushFlags[],
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
	const { preserveFocus, ...opts } = { ...options, commit: stash };
	return Container.instance.commitDetailsView.show({ preserveFocus: preserveFocus }, opts);
}
