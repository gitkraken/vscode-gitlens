'use strict';
import { GitActions } from '../commands';
import {
	command,
	Command,
	CommandContext,
	Commands,
	isCommandContextViewNodeHasCommit,
	isCommandContextViewNodeHasRepository,
} from './common';
import { GitStashCommit, GitStashReference } from '../git/git';
import { CommandQuickPickItem } from '../quickpicks';

export interface StashApplyCommandArgs {
	deleteAfter?: boolean;
	repoPath?: string;
	stashItem?: GitStashReference & { message: string };

	goBackCommand?: CommandQuickPickItem;
}

@command()
export class StashApplyCommand extends Command {
	constructor() {
		super(Commands.StashApply);
	}

	protected preExecute(context: CommandContext, args?: StashApplyCommandArgs) {
		if (isCommandContextViewNodeHasCommit<GitStashCommit>(context)) {
			args = { ...args, stashItem: context.node.commit };
		} else if (isCommandContextViewNodeHasRepository(context)) {
			args = { ...args, repoPath: context.node.repo.path };
		}

		return this.execute(args);
	}

	async execute(args?: StashApplyCommandArgs) {
		if (args?.deleteAfter) {
			return GitActions.Stash.pop(args?.repoPath ?? args?.stashItem?.repoPath, args?.stashItem);
		}

		return GitActions.Stash.apply(args?.repoPath ?? args?.stashItem?.repoPath, args?.stashItem);
	}
}
