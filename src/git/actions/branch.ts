import type { GitBranchReference, GitReference } from '@gitlens/git/models/reference.js';
import { Container } from '../../container.js';
import type { ViewNode } from '../../views/nodes/abstract/viewNode.js';
import type { RevealOptions } from '../../views/viewBase.js';
import { executeGitCommand } from '../actions.js';
import type { GlRepository } from '../models/repository.js';

export function changeUpstream(repo?: string | GlRepository, branch?: GitBranchReference): Promise<void> {
	return executeGitCommand({ command: 'branch', state: { subcommand: 'upstream', repo: repo, reference: branch } });
}

export function create(repo?: string | GlRepository, ref?: GitReference, name?: string): Promise<void> {
	return executeGitCommand({
		command: 'branch',
		state: { subcommand: 'create', repo: repo, reference: ref, name: name },
	});
}

export function remove(repo?: string | GlRepository, refs?: GitBranchReference | GitBranchReference[]): Promise<void> {
	return executeGitCommand({
		command: 'branch',
		state: { subcommand: 'delete', repo: repo, references: refs },
	});
}

export function rename(repo?: string | GlRepository, ref?: GitBranchReference, name?: string): Promise<void> {
	return executeGitCommand({
		command: 'branch',
		state: { subcommand: 'rename', repo: repo, reference: ref, name: name },
	});
}

export function revealBranch(branch: GitBranchReference, options?: RevealOptions): Promise<ViewNode | undefined> {
	return Container.instance.views.revealBranch(branch, options);
}
