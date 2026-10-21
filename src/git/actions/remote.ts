import type { GitRemote } from '@gitlens/git/models/remote.js';
import { Container } from '../../container.js';
import type { ViewNode } from '../../views/nodes/abstract/viewNode.js';
import type { RevealOptions } from '../../views/viewBase.js';
import { executeGitCommand } from '../actions.js';
import type { GlRepository } from '../models/repository.js';

export function add(
	repo?: string | GlRepository,
	name?: string,
	url?: string,
	options?: {
		confirm?: boolean;
		/** Pre-fills the name step when no `name` is given */
		defaultName?: string;
		/** `true` pre-selects fetching; `false` never fetches and doesn't offer to */
		fetch?: boolean;
		reveal?: boolean;
	},
): Promise<void> {
	return executeGitCommand({
		command: 'remote',
		confirm: options?.confirm,
		state: {
			repo: repo,
			subcommand: 'add',
			name: name,
			url: url,
			flags: options?.fetch ? ['-f'] : undefined,
			defaultName: options?.defaultName,
			fetch: options?.fetch,
			reveal: options?.reveal,
		},
	});
}

export async function fetch(repo: string | GlRepository, remote: string): Promise<void> {
	if (typeof repo === 'string') {
		const r = Container.instance.git.getRepository(repo);
		if (r == null) return;

		repo = r;
	}

	await repo.git.fetch({ remote: remote });
}

export async function prune(repo: string | GlRepository, remote: string): Promise<void> {
	return executeGitCommand({
		command: 'remote',
		state: { repo: repo, subcommand: 'prune', remote: remote },
	});
}

export async function remove(repo: string | GlRepository, remote: string): Promise<void> {
	return executeGitCommand({
		command: 'remote',
		state: { repo: repo, subcommand: 'remove', remote: remote },
	});
}

export function revealRemote(remote: GitRemote | undefined, options?: RevealOptions): Promise<ViewNode | undefined> {
	return Container.instance.views.revealRemote(remote, options);
}
