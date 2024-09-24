import { Commands } from '../constants.commands';
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
			Commands.GitCommands,
			Commands.GitCommandsBranch,
			Commands.GitCommandsBranchCreate,
			Commands.GitCommandsBranchDelete,
			Commands.GitCommandsBranchPrune,
			Commands.GitCommandsBranchRename,
			Commands.GitCommandsCheckout,
			Commands.GitCommandsCherryPick,
			Commands.GitCommandsHistory,
			Commands.GitCommandsMerge,
			Commands.GitCommandsRebase,
			Commands.GitCommandsRemote,
			Commands.GitCommandsRemoteAdd,
			Commands.GitCommandsRemotePrune,
			Commands.GitCommandsRemoteRemove,
			Commands.GitCommandsReset,
			Commands.GitCommandsRevert,
			Commands.GitCommandsShow,
			Commands.GitCommandsStash,
			Commands.GitCommandsStashDrop,
			Commands.GitCommandsStashList,
			Commands.GitCommandsStashPop,
			Commands.GitCommandsStashPush,
			Commands.GitCommandsStashRename,
			Commands.GitCommandsStatus,
			Commands.GitCommandsSwitch,
			Commands.GitCommandsTag,
			Commands.GitCommandsTagCreate,
			Commands.GitCommandsTagDelete,
			Commands.GitCommandsWorktree,
			Commands.GitCommandsWorktreeCreate,
			Commands.GitCommandsWorktreeDelete,
			Commands.GitCommandsWorktreeOpen,

			Commands.CopyWorkingChangesToWorktree,
		]);
	}

	protected override preExecute(
		context: CommandContext,
		args?: QuickWizardCommandArgsWithCompletion<GitWizardCommandArgs>,
	) {
		switch (context.command) {
			case Commands.GitCommandsBranch:
				return this.execute({ command: 'branch' });
			case Commands.GitCommandsBranchCreate:
				return this.execute({ command: 'branch', state: { subcommand: 'create' } });
			case Commands.GitCommandsBranchDelete:
				return this.execute({ command: 'branch', state: { subcommand: 'delete' } });
			case Commands.GitCommandsBranchPrune:
				return this.execute({ command: 'branch', state: { subcommand: 'prune' } });
			case Commands.GitCommandsBranchRename:
				return this.execute({ command: 'branch', state: { subcommand: 'rename' } });
			case Commands.GitCommandsCherryPick:
				return this.execute({ command: 'cherry-pick' });
			case Commands.GitCommandsHistory:
				return this.execute({ command: 'log' });
			case Commands.GitCommandsMerge:
				return this.execute({ command: 'merge' });
			case Commands.GitCommandsRebase:
				return this.execute({ command: 'rebase' });
			case Commands.GitCommandsRemote:
				return this.execute({ command: 'remote' });
			case Commands.GitCommandsRemoteAdd:
				return this.execute({ command: 'remote', state: { subcommand: 'add' } });
			case Commands.GitCommandsRemotePrune:
				return this.execute({ command: 'remote', state: { subcommand: 'prune' } });
			case Commands.GitCommandsRemoteRemove:
				return this.execute({ command: 'remote', state: { subcommand: 'remove' } });
			case Commands.GitCommandsReset:
				return this.execute({ command: 'reset' });
			case Commands.GitCommandsRevert:
				return this.execute({ command: 'revert' });
			case Commands.GitCommandsShow:
				return this.execute({ command: 'show' });
			case Commands.GitCommandsStash:
				return this.execute({ command: 'stash' });
			case Commands.GitCommandsStashDrop:
				return this.execute({ command: 'stash', state: { subcommand: 'drop' } });
			case Commands.GitCommandsStashList:
				return this.execute({ command: 'stash', state: { subcommand: 'list' } });
			case Commands.GitCommandsStashPop:
				return this.execute({ command: 'stash', state: { subcommand: 'pop' } });
			case Commands.GitCommandsStashPush:
				return this.execute({ command: 'stash', state: { subcommand: 'push' } });
			case Commands.GitCommandsStashRename:
				return this.execute({ command: 'stash', state: { subcommand: 'rename' } });
			case Commands.GitCommandsStatus:
				return this.execute({ command: 'status' });
			case Commands.GitCommandsSwitch:
			case Commands.GitCommandsCheckout:
				return this.execute({ command: 'switch' });
			case Commands.GitCommandsTag:
				return this.execute({ command: 'tag' });
			case Commands.GitCommandsTagCreate:
				return this.execute({ command: 'tag', state: { subcommand: 'create' } });
			case Commands.GitCommandsTagDelete:
				return this.execute({ command: 'tag', state: { subcommand: 'delete' } });
			case Commands.GitCommandsWorktree:
				return this.execute({ command: 'worktree' });
			case Commands.GitCommandsWorktreeCreate:
				return this.execute({ command: 'worktree', state: { subcommand: 'create' } });
			case Commands.GitCommandsWorktreeDelete:
				return this.execute({ command: 'worktree', state: { subcommand: 'delete' } });
			case Commands.GitCommandsWorktreeOpen:
				return this.execute({ command: 'worktree', state: { subcommand: 'open' } });

			case Commands.CopyWorkingChangesToWorktree:
				return this.execute({
					command: 'worktree',
					state: { subcommand: 'copy-changes', changes: { type: 'working-tree' } },
				});

			default:
				return this.execute(args);
		}
	}
}
