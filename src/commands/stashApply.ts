import type { Container } from '../container.js';
import { apply, pop } from '../git/actions/stash.js';
import type { GitStashCommit } from '../git/models/commit.js';
import type { GitStashReference } from '../git/models/reference.js';
import type { CommandQuickPickItem } from '../quickpicks/items/common.js';
import { command } from '../system/-webview/command.js';
import { GlCommandBase } from './commandBase.js';
import type { CommandContext } from './commandContext.js';
import { isCommandContextViewNodeHasCommit, isCommandContextViewNodeHasRepository } from './commandContext.utils.js';

export interface StashApplyCommandArgs {
	deleteAfter?: boolean;
	repoPath?: string;
	stashItem?: GitStashReference & { message: string | undefined };

	goBackCommand?: CommandQuickPickItem;
}

@command()
export class StashApplyCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(['gitlens.stashesApply', 'gitlens.stashesApply:views']);
	}

	protected override async preExecute(context: CommandContext, args?: StashApplyCommandArgs): Promise<void> {
		if (context.command === 'gitlens.stashesApply:views') {
			if (isCommandContextViewNodeHasCommit<GitStashCommit>(context)) {
				if (context.node.commit.message == null) {
					await context.node.commit.ensureFullDetails();
				}
				args = { ...args, stashItem: context.node.commit };
			} else if (isCommandContextViewNodeHasRepository(context)) {
				args = { ...args, repoPath: context.node.repo.path };
			}
		}

		return this.execute(args);
	}

	async execute(args?: StashApplyCommandArgs): Promise<void> {
		if (args?.deleteAfter) {
			return pop(args?.repoPath ?? args?.stashItem?.repoPath, args?.stashItem);
		}

		return apply(args?.repoPath ?? args?.stashItem?.repoPath, args?.stashItem);
	}
}
