import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { command } from '../system/vscode/command';
import type { CommandContext } from './base';
import type { BranchGitCommandArgs } from './git/branch';
import type { CherryPickGitCommandArgs } from './git/cherry-pick';
import type { CoAuthorsGitCommandArgs } from './git/coauthors';
import type { FetchGitCommandArgs } from './git/fetch';
import type { LogGitCommandArgs } from './git/log';
import type { MergeGitCommandArgs } from './git/merge';
import type { PullGitCommandArgs } from './git/pull';
import type { PushGitCommandArgs } from './git/push';
import type { RebaseGitCommandArgs } from './git/rebase';
import type { RemoteGitCommandArgs } from './git/remote';
import type { ResetGitCommandArgs } from './git/reset';
import type { RevertGitCommandArgs } from './git/revert';
import type { SearchGitCommandArgs } from './git/search';
import type { ShowGitCommandArgs } from './git/show';
import type { StashGitCommandArgs } from './git/stash';
import type { StatusGitCommandArgs } from './git/status';
import type { SwitchGitCommandArgs } from './git/switch';
import type { TagGitCommandArgs } from './git/tag';
import type { WorktreeGitCommandArgs } from './git/worktree';
import type { QuickWizardCommandArgsWithCompletion } from './quickWizard.base';
import { QuickWizardCommandBase } from './quickWizard.base';

export type GitWizardCommandArgs =
	| BranchGitCommandArgs
	| CherryPickGitCommandArgs
	| CoAuthorsGitCommandArgs
	| FetchGitCommandArgs
	| LogGitCommandArgs
	| MergeGitCommandArgs
	| PullGitCommandArgs
	| PushGitCommandArgs
	| RebaseGitCommandArgs
	| RemoteGitCommandArgs
	| ResetGitCommandArgs
	| RevertGitCommandArgs
	| SearchGitCommandArgs
	| ShowGitCommandArgs
	| StashGitCommandArgs
	| StatusGitCommandArgs
	| SwitchGitCommandArgs
	| TagGitCommandArgs
	| WorktreeGitCommandArgs;

@command()
export class GitWizardCommand extends QuickWizardCommandBase {
	constructor(container: Container) {
		super(container, [
			GlCommand.GitCommands,
			GlCommand.GitCommandsBranch,
			GlCommand.GitCommandsBranchCreate,
			GlCommand.GitCommandsBranchDelete,
			GlCommand.GitCommandsBranchPrune,
			GlCommand.GitCommandsBranchRename,
			GlCommand.GitCommandsCheckout,
			GlCommand.GitCommandsCherryPick,
			GlCommand.GitCommandsHistory,
			GlCommand.GitCommandsMerge,
			GlCommand.GitCommandsRebase,
			GlCommand.GitCommandsRemote,
			GlCommand.GitCommandsRemoteAdd,
			GlCommand.GitCommandsRemotePrune,
			GlCommand.GitCommandsRemoteRemove,
			GlCommand.GitCommandsReset,
			GlCommand.GitCommandsRevert,
			GlCommand.GitCommandsShow,
			GlCommand.GitCommandsStash,
			GlCommand.GitCommandsStashDrop,
			GlCommand.GitCommandsStashList,
			GlCommand.GitCommandsStashPop,
			GlCommand.GitCommandsStashPush,
			GlCommand.GitCommandsStashRename,
			GlCommand.GitCommandsStatus,
			GlCommand.GitCommandsSwitch,
			GlCommand.GitCommandsTag,
			GlCommand.GitCommandsTagCreate,
			GlCommand.GitCommandsTagDelete,
			GlCommand.GitCommandsWorktree,
			GlCommand.GitCommandsWorktreeCreate,
			GlCommand.GitCommandsWorktreeDelete,
			GlCommand.GitCommandsWorktreeOpen,

			GlCommand.CopyWorkingChangesToWorktree,
		]);
	}

	protected override preExecute(
		context: CommandContext,
		args?: QuickWizardCommandArgsWithCompletion<GitWizardCommandArgs>,
	) {
		switch (context.command) {
			case GlCommand.GitCommandsBranch:
				return this.execute({ command: 'branch', ...args });
			case GlCommand.GitCommandsBranchCreate:
				return this.execute({ command: 'branch', state: { subcommand: 'create' } });
			case GlCommand.GitCommandsBranchDelete:
				return this.execute({ command: 'branch', state: { subcommand: 'delete' } });
			case GlCommand.GitCommandsBranchPrune:
				return this.execute({ command: 'branch', state: { subcommand: 'prune' } });
			case GlCommand.GitCommandsBranchRename:
				return this.execute({ command: 'branch', state: { subcommand: 'rename' } });
			case GlCommand.GitCommandsCherryPick:
				return this.execute({ command: 'cherry-pick' });
			case GlCommand.GitCommandsHistory:
				return this.execute({ command: 'log' });
			case GlCommand.GitCommandsMerge:
				return this.execute({ command: 'merge' });
			case GlCommand.GitCommandsRebase:
				return this.execute({ command: 'rebase' });
			case GlCommand.GitCommandsRemote:
				return this.execute({ command: 'remote' });
			case GlCommand.GitCommandsRemoteAdd:
				return this.execute({ command: 'remote', state: { subcommand: 'add' } });
			case GlCommand.GitCommandsRemotePrune:
				return this.execute({ command: 'remote', state: { subcommand: 'prune' } });
			case GlCommand.GitCommandsRemoteRemove:
				return this.execute({ command: 'remote', state: { subcommand: 'remove' } });
			case GlCommand.GitCommandsReset:
				return this.execute({ command: 'reset' });
			case GlCommand.GitCommandsRevert:
				return this.execute({ command: 'revert' });
			case GlCommand.GitCommandsShow:
				return this.execute({ command: 'show' });
			case GlCommand.GitCommandsStash:
				return this.execute({ command: 'stash' });
			case GlCommand.GitCommandsStashDrop:
				return this.execute({ command: 'stash', state: { subcommand: 'drop' } });
			case GlCommand.GitCommandsStashList:
				return this.execute({ command: 'stash', state: { subcommand: 'list' } });
			case GlCommand.GitCommandsStashPop:
				return this.execute({ command: 'stash', state: { subcommand: 'pop' } });
			case GlCommand.GitCommandsStashPush:
				return this.execute({ command: 'stash', state: { subcommand: 'push' } });
			case GlCommand.GitCommandsStashRename:
				return this.execute({ command: 'stash', state: { subcommand: 'rename' } });
			case GlCommand.GitCommandsStatus:
				return this.execute({ command: 'status' });
			case GlCommand.GitCommandsSwitch:
			case GlCommand.GitCommandsCheckout:
				return this.execute({ command: 'switch' });
			case GlCommand.GitCommandsTag:
				return this.execute({ command: 'tag' });
			case GlCommand.GitCommandsTagCreate:
				return this.execute({ command: 'tag', state: { subcommand: 'create' } });
			case GlCommand.GitCommandsTagDelete:
				return this.execute({ command: 'tag', state: { subcommand: 'delete' } });
			case GlCommand.GitCommandsWorktree:
				return this.execute({ command: 'worktree' });
			case GlCommand.GitCommandsWorktreeCreate:
				return this.execute({ command: 'worktree', state: { subcommand: 'create' } });
			case GlCommand.GitCommandsWorktreeDelete:
				return this.execute({ command: 'worktree', state: { subcommand: 'delete' } });
			case GlCommand.GitCommandsWorktreeOpen:
				return this.execute({ command: 'worktree', state: { subcommand: 'open' } });

			case GlCommand.CopyWorkingChangesToWorktree:
				return this.execute({
					command: 'worktree',
					state: { subcommand: 'copy-changes', changes: { type: 'working-tree' } },
				});

			default:
				return this.execute(args);
		}
	}
}
