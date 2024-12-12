import type { Uri } from 'vscode';
import type { ScmResource } from '../@types/vscode.git.resources';
import { ScmResourceGroupType, ScmStatus } from '../@types/vscode.git.resources.enums';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { Features } from '../features';
import { push } from '../git/actions/stash';
import { GitUri } from '../git/gitUri';
import { command } from '../system/vscode/command';
import type { CommandContext } from './base';
import {
	GlCommandBase,
	isCommandContextViewNodeHasFile,
	isCommandContextViewNodeHasRepoPath,
	isCommandContextViewNodeHasRepository,
} from './base';

export interface StashSaveCommandArgs {
	message?: string;
	repoPath?: string;
	uris?: Uri[];
	includeUntracked?: boolean;
	keepStaged?: boolean;
	onlyStaged?: boolean;
	onlyStagedUris?: Uri[];
}

@command()
export class StashSaveCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super([GlCommand.StashSave, GlCommand.StashSaveFiles]);
	}

	protected override async preExecute(context: CommandContext, args?: StashSaveCommandArgs) {
		if (isCommandContextViewNodeHasFile(context)) {
			args = { ...args };
			args.repoPath = context.node.file.repoPath ?? context.node.repoPath;
			args.uris = [GitUri.fromFile(context.node.file, args.repoPath)];
		} else if (isCommandContextViewNodeHasRepository(context)) {
			args = { ...args };
			args.repoPath = context.node.repo.path;
		} else if (isCommandContextViewNodeHasRepoPath(context)) {
			args = { ...args };
			args.repoPath = context.node.repoPath;
		} else if (context.type === 'scm') {
			if (context.scm.rootUri != null) {
				const repo = this.container.git.getRepository(context.scm.rootUri);
				if (repo != null) {
					args = { ...args };
					args.repoPath = repo.path;
				}
			}
		} else if (context.type === 'scm-states') {
			args = { ...args };

			let hasOnlyStaged = undefined;
			let hasStaged = false;
			let hasUntracked = false;

			const uris: Uri[] = [];

			for (const resource of context.scmResourceStates as ScmResource[]) {
				uris.push(resource.resourceUri);
				if (resource.type === ScmStatus.UNTRACKED) {
					hasUntracked = true;
				}

				if (resource.resourceGroupType === ScmResourceGroupType.Index) {
					hasStaged = true;
					if (hasOnlyStaged == null) {
						hasOnlyStaged = true;
					}
				} else {
					hasOnlyStaged = false;
				}
			}

			const repo = await this.container.git.getOrOpenRepository(uris[0]);

			args.repoPath = repo?.path;
			args.onlyStaged = repo != null && hasOnlyStaged ? await repo.git.supports(Features.StashOnlyStaged) : false;
			if (args.keepStaged == null && !hasStaged) {
				args.keepStaged = true;
			}
			args.includeUntracked = hasUntracked;

			args.uris = uris;
		} else if (context.type === 'scm-groups') {
			args = { ...args };

			let hasOnlyStaged = undefined;
			let hasStaged = false;
			let hasUntracked = false;

			const uris: Uri[] = [];
			const stagedUris: Uri[] = [];

			for (const group of context.scmResourceGroups) {
				for (const resource of group.resourceStates as ScmResource[]) {
					uris.push(resource.resourceUri);
					if (resource.type === ScmStatus.UNTRACKED) {
						hasUntracked = true;
					}
				}

				if (group.id === 'index') {
					hasStaged = true;
					if (hasOnlyStaged == null) {
						hasOnlyStaged = true;
					}
					stagedUris.push(...group.resourceStates.map(s => s.resourceUri));
				} else {
					hasOnlyStaged = false;
				}
			}

			const repo = await this.container.git.getOrOpenRepository(uris[0]);

			args.repoPath = repo?.path;
			args.onlyStaged = repo != null && hasOnlyStaged ? await repo.git.supports(Features.StashOnlyStaged) : false;
			if (args.keepStaged == null && !hasStaged) {
				args.keepStaged = true;
			}
			args.includeUntracked = hasUntracked;

			if (args.onlyStaged) {
				args.onlyStagedUris = stagedUris;
			} else {
				args.uris = uris;
			}
		}

		return this.execute(args);
	}

	execute(args?: StashSaveCommandArgs) {
		return push(
			args?.repoPath,
			args?.uris,
			args?.message,
			args?.includeUntracked,
			args?.keepStaged,
			args?.onlyStaged,
			args?.onlyStagedUris,
		);
	}
}
