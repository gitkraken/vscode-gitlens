import { Container } from '../../container';
import { executeGitCommand } from '../actions';
import type { GitRemote } from '../models/remote';
import type { Repository } from '../models/repository';

export function add(
	repo?: string | Repository,
	name?: string,
	url?: string,
	options?: { confirm?: boolean; fetch?: boolean; reveal?: boolean },
) {
	return executeGitCommand({
		command: 'remote',
		confirm: options?.confirm,
		state: {
			repo: repo,
			subcommand: 'add',
			name: name,
			url: url,
			flags: options?.fetch ? ['-f'] : undefined,
			reveal: options?.reveal,
		},
	});
}

export async function fetch(repo: string | Repository, remote: string) {
	if (typeof repo === 'string') {
		const r = Container.instance.git.getRepository(repo);
		if (r == null) return;

		repo = r;
	}

	await repo.fetch({ remote: remote });
}

export async function prune(repo: string | Repository, remote: string) {
	return executeGitCommand({
		command: 'remote',
		state: { repo: repo, subcommand: 'prune', remote: remote },
	});
}

export async function remove(repo: string | Repository, remote: string) {
	return executeGitCommand({
		command: 'remote',
		state: { repo: repo, subcommand: 'remove', remote: remote },
	});
}

export async function reveal(
	remote: GitRemote | undefined,
	options?: {
		select?: boolean;
		focus?: boolean;
		expand?: boolean | number;
	},
) {
	const view = Container.instance.remotesView;
	const node =
		remote != null
			? view.canReveal
				? await view.revealRemote(remote, options)
				: await Container.instance.repositoriesView.revealRemote(remote, options)
			: undefined;
	if (node == null) {
		void view.show({ preserveFocus: !options?.focus });
	}
	return node;
}
