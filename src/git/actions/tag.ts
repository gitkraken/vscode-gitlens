import type { GitReference, GitTagReference } from '@gitlens/git/models/reference.js';
import { Container } from '../../container.js';
import type { ViewNode } from '../../views/nodes/abstract/viewNode.js';
import type { RevealOptions } from '../../views/viewBase.js';
import { executeGitCommand } from '../actions.js';
import type { GlRepository } from '../models/repository.js';

export function create(repo?: string | GlRepository, ref?: GitReference, name?: string): Promise<void> {
	return executeGitCommand({
		command: 'tag',
		state: { subcommand: 'create', repo: repo, reference: ref, name: name },
	});
}

export function remove(repo?: string | GlRepository, refs?: GitTagReference | GitTagReference[]): Promise<void> {
	return executeGitCommand({
		command: 'tag',
		state: { subcommand: 'delete', repo: repo, references: refs },
	});
}

export function revealTag(tag: GitTagReference, options?: RevealOptions): Promise<ViewNode | undefined> {
	return Container.instance.views.revealTag(tag, options);
}
