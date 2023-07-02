import type { Uri } from 'vscode';
import type { ScmResource } from '../@types/vscode.git.resources';
import { ScmResourceGroupType } from '../@types/vscode.git.resources.enums';
import { Commands } from '../constants';
import type { Container } from '../container';
import { Features } from '../features';
import { push } from '../git/actions/stash';
import { GitUri } from '../git/gitUri';
import { command } from '../system/command';
import type { CommandContext } from './base';
import {
	Command,
	isCommandContextViewNodeHasFile,
	isCommandContextViewNodeHasRepoPath,
	isCommandContextViewNodeHasRepository,
} from './base';

export interface StashSaveCommandArgs {
	message?: string;
	repoPath?: string;
	uris?: Uri[];
	keepStaged?: boolean;
	onlyStaged?: boolean;
	onlyStagedUris?: Uri[];
}

@command()
export class StashSaveCommand extends Command {
	constructor(private readonly container: Container) {
		super([Commands.StashSave, Commands.StashSaveFiles]);
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
		} else if (context.type === 'scm-states') {
			args = { ...args };
			args.uris = context.scmResourceStates.map(s => s.resourceUri);
			args.repoPath = (await this.container.git.getOrOpenRepository(args.uris[0]))?.path;

			if (
				!context.scmResourceStates.some(
					s => (s as ScmResource).resourceGroupType === ScmResourceGroupType.Index,
				)
			) {
				args.keepStaged = true;
			}
		} else if (context.type === 'scm-groups') {
			args = { ...args };

			let isStagedOnly = true;
			let hasStaged = false;
			const uris = context.scmResourceGroups.reduce<Uri[]>((a, b) => {
				const isStaged = b.id === 'index';
				if (isStagedOnly && !isStaged) {
					isStagedOnly = false;
				}
				if (isStaged) {
					hasStaged = true;
				}
				return a.concat(b.resourceStates.map(s => s.resourceUri));
			}, []);

			const repo = await this.container.git.getOrOpenRepository(uris[0]);
			let canUseStagedOnly = false;
			if (isStagedOnly && repo != null) {
				canUseStagedOnly = await repo.supports(Features.StashOnlyStaged);
			}

			if (canUseStagedOnly) {
				args.onlyStaged = true;
				args.onlyStagedUris = uris;
			} else {
				args.uris = uris;
				args.repoPath = repo?.path;

				if (!hasStaged) {
					args.keepStaged = true;
				}
			}
		}

		return this.execute(args);
	}

	execute(args?: StashSaveCommandArgs) {
		return push(
			args?.repoPath,
			args?.uris,
			args?.message,
			args?.keepStaged,
			args?.onlyStaged,
			args?.onlyStagedUris,
		);
	}
}
