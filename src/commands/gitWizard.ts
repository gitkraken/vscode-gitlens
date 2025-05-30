import type { Container } from '../container';
import { command } from '../system/-webview/command';
import type { CommandContext } from './commandContext';
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
			'gitlens.gitCommands',
			'gitlens.gitCommands.branch',
			'gitlens.gitCommands.branch.create',
			'gitlens.gitCommands.branch.delete',
			'gitlens.gitCommands.branch.prune',
			'gitlens.gitCommands.branch.rename',
			'gitlens.gitCommands.checkout',
			'gitlens.gitCommands.cherryPick',
			'gitlens.gitCommands.history',
			'gitlens.gitCommands.merge',
			'gitlens.gitCommands.rebase',
			'gitlens.gitCommands.remote',
			'gitlens.gitCommands.remote.add',
			'gitlens.gitCommands.remote.prune',
			'gitlens.gitCommands.remote.remove',
			'gitlens.gitCommands.reset',
			'gitlens.gitCommands.revert',
			'gitlens.gitCommands.show',
			'gitlens.gitCommands.stash',
			'gitlens.gitCommands.stash.drop',
			'gitlens.gitCommands.stash.list',
			'gitlens.gitCommands.stash.pop',
			'gitlens.gitCommands.stash.push',
			'gitlens.gitCommands.stash.rename',
			'gitlens.gitCommands.status',
			'gitlens.gitCommands.switch',
			'gitlens.gitCommands.tag',
			'gitlens.gitCommands.tag.create',
			'gitlens.gitCommands.tag.delete',
			'gitlens.gitCommands.worktree',
			'gitlens.gitCommands.worktree.create',
			'gitlens.gitCommands.worktree.delete',
			'gitlens.gitCommands.worktree.open',

			'gitlens.copyWorkingChangesToWorktree',
		]);
	}

	protected override preExecute(
		context: CommandContext,
		args?: QuickWizardCommandArgsWithCompletion<GitWizardCommandArgs>,
	): Promise<void> {
		switch (context.command) {
			case 'gitlens.gitCommands.branch':
				return this.execute({ command: 'branch', ...args });
			case 'gitlens.gitCommands.branch.create':
				return this.execute({ command: 'branch', state: { subcommand: 'create' } });
			case 'gitlens.gitCommands.branch.delete':
				return this.execute({ command: 'branch', state: { subcommand: 'delete' } });
			case 'gitlens.gitCommands.branch.prune':
				return this.execute({ command: 'branch', state: { subcommand: 'prune' } });
			case 'gitlens.gitCommands.branch.rename':
				return this.execute({ command: 'branch', state: { subcommand: 'rename' } });
			case 'gitlens.gitCommands.cherryPick':
				return this.execute({ command: 'cherry-pick' });
			case 'gitlens.gitCommands.history':
				return this.execute({ command: 'log' });
			case 'gitlens.gitCommands.merge':
				return this.execute({ command: 'merge' });
			case 'gitlens.gitCommands.rebase':
				return this.execute({ command: 'rebase' });
			case 'gitlens.gitCommands.remote':
				return this.execute({ command: 'remote' });
			case 'gitlens.gitCommands.remote.add':
				return this.execute({ command: 'remote', state: { subcommand: 'add' } });
			case 'gitlens.gitCommands.remote.prune':
				return this.execute({ command: 'remote', state: { subcommand: 'prune' } });
			case 'gitlens.gitCommands.remote.remove':
				return this.execute({ command: 'remote', state: { subcommand: 'remove' } });
			case 'gitlens.gitCommands.reset':
				return this.execute({ command: 'reset' });
			case 'gitlens.gitCommands.revert':
				return this.execute({ command: 'revert' });
			case 'gitlens.gitCommands.show':
				return this.execute({ command: 'show' });
			case 'gitlens.gitCommands.stash':
				return this.execute({ command: 'stash' });
			case 'gitlens.gitCommands.stash.drop':
				return this.execute({ command: 'stash', state: { subcommand: 'drop' } });
			case 'gitlens.gitCommands.stash.list':
				return this.execute({ command: 'stash', state: { subcommand: 'list' } });
			case 'gitlens.gitCommands.stash.pop':
				return this.execute({ command: 'stash', state: { subcommand: 'pop' } });
			case 'gitlens.gitCommands.stash.push':
				return this.execute({ command: 'stash', state: { subcommand: 'push' } });
			case 'gitlens.gitCommands.stash.rename':
				return this.execute({ command: 'stash', state: { subcommand: 'rename' } });
			case 'gitlens.gitCommands.status':
				return this.execute({ command: 'status' });
			case 'gitlens.gitCommands.switch':
			case 'gitlens.gitCommands.checkout':
				return this.execute({ command: 'switch' });
			case 'gitlens.gitCommands.tag':
				return this.execute({ command: 'tag' });
			case 'gitlens.gitCommands.tag.create':
				return this.execute({ command: 'tag', state: { subcommand: 'create' } });
			case 'gitlens.gitCommands.tag.delete':
				return this.execute({ command: 'tag', state: { subcommand: 'delete' } });
			case 'gitlens.gitCommands.worktree':
				return this.execute({ command: 'worktree' });
			case 'gitlens.gitCommands.worktree.create':
				return this.execute({ command: 'worktree', state: { subcommand: 'create' } });
			case 'gitlens.gitCommands.worktree.delete':
				return this.execute({ command: 'worktree', state: { subcommand: 'delete' } });
			case 'gitlens.gitCommands.worktree.open':
				return this.execute({ command: 'worktree', state: { subcommand: 'open' } });

			case 'gitlens.copyWorkingChangesToWorktree':
				return this.execute({
					command: 'worktree',
					state: { subcommand: 'copy-changes', changes: { type: 'working-tree' } },
				});

			default:
				return this.execute(args);
		}
	}
}
