import { Commands } from '../constants';
import type { Container } from '../container';
import { apply, pop } from '../git/actions/stash';
import type { GitStashCommit } from '../git/models/commit';
import type { GitStashReference } from '../git/models/reference';
import type { CommandQuickPickItem } from '../quickpicks/items/common';
import { command } from '../system/command';
import type { CommandContext } from './base';
import { Command, isCommandContextViewNodeHasCommit, isCommandContextViewNodeHasRepository } from './base';

export interface StashApplyCommandArgs {
	deleteAfter?: boolean;
	repoPath?: string;
	stashItem?: GitStashReference & { message: string | undefined };

	goBackCommand?: CommandQuickPickItem;
}

@command()
export class StashApplyCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.StashApply);
	}

	protected override async preExecute(context: CommandContext, args?: StashApplyCommandArgs) {
		if (isCommandContextViewNodeHasCommit<GitStashCommit>(context)) {
			if (context.node.commit.message == null) {
				await context.node.commit.ensureFullDetails();
			}
			args = { ...args, stashItem: context.node.commit };
		} else if (isCommandContextViewNodeHasRepository(context)) {
			args = { ...args, repoPath: context.node.repo.path };
		}

		return this.execute(args);
	}

	async execute(args?: StashApplyCommandArgs) {
		if (args?.deleteAfter) {
			return pop(args?.repoPath ?? args?.stashItem?.repoPath, args?.stashItem);
		}

		return apply(args?.repoPath ?? args?.stashItem?.repoPath, args?.stashItem);
	}
}
