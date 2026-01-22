import type { Container } from '../container.js';
import { command } from '../system/-webview/command.js';
import type { CommandContext } from './commandContext.js';
import type { BranchGitCommandArgs } from './git/branch.js';
import type { CherryPickGitCommandArgs } from './git/cherry-pick.js';
import type { CoAuthorsGitCommandArgs } from './git/coauthors.js';
import type { FetchGitCommandArgs } from './git/fetch.js';
import type { LogGitCommandArgs } from './git/log.js';
import type { MergeGitCommandArgs } from './git/merge.js';
import type { PullGitCommandArgs } from './git/pull.js';
import type { PushGitCommandArgs } from './git/push.js';
import type { RebaseGitCommandArgs } from './git/rebase.js';
import type { RemoteGitCommandArgs } from './git/remote.js';
import type { ResetGitCommandArgs } from './git/reset.js';
import type { RevertGitCommandArgs } from './git/revert.js';
import type { SearchGitCommandArgs } from './git/search.js';
import type { ShowGitCommandArgs } from './git/show.js';
import type { StashGitCommandArgs } from './git/stash.js';
import type { StatusGitCommandArgs } from './git/status.js';
import type { SwitchGitCommandArgs } from './git/switch.js';
import type { TagGitCommandArgs } from './git/tag.js';
import type { WorktreeGitCommandArgs } from './git/worktree.js';
import type { QuickWizardCommandArgsWithCompletion } from './quick-wizard/models/quickWizard.js';
import { QuickWizardCommandBase } from './quick-wizard/quickWizardCommandBase.js';

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
			'gitlens.git.branch',
			'gitlens.git.branch.create',
			'gitlens.git.branch.delete',
			'gitlens.git.branch.prune',
			'gitlens.git.branch.rename',
			'gitlens.git.branch.setMergeTarget',
			'gitlens.git.branch.setUpstream',
			'gitlens.git.checkout',
			'gitlens.git.cherryPick',
			'gitlens.git.history',
			'gitlens.git.merge',
			'gitlens.git.rebase',
			'gitlens.git.remote',
			'gitlens.git.remote.add',
			'gitlens.git.remote.prune',
			'gitlens.git.remote.remove',
			'gitlens.git.reset',
			'gitlens.git.revert',
			'gitlens.git.show',
			'gitlens.git.stash',
			'gitlens.git.stash.drop',
			'gitlens.git.stash.list',
			'gitlens.git.stash.pop',
			'gitlens.git.stash.push',
			'gitlens.git.stash.rename',
			'gitlens.git.status',
			'gitlens.git.switch',
			'gitlens.git.tag',
			'gitlens.git.tag.create',
			'gitlens.git.tag.delete',
			'gitlens.git.worktree',
			'gitlens.git.worktree.copyWorkingChangesTo',
			'gitlens.copyWorkingChangesToWorktree',
			'gitlens.git.worktree.create',
			'gitlens.git.worktree.delete',
			'gitlens.git.worktree.open',
		]);
	}

	protected override preExecute(
		context: CommandContext,
		args?: QuickWizardCommandArgsWithCompletion<GitWizardCommandArgs>,
	): Promise<void> {
		switch (context.command) {
			case 'gitlens.git.branch':
				return this.execute({ command: 'branch', ...args });
			case 'gitlens.git.branch.create':
				return this.execute(getSubcommandArgs(args, 'branch', 'create'));
			case 'gitlens.git.branch.delete':
				return this.execute(getSubcommandArgs(args, 'branch', 'delete'));
			case 'gitlens.git.branch.prune':
				return this.execute(getSubcommandArgs(args, 'branch', 'prune'));
			case 'gitlens.git.branch.rename':
				return this.execute(getSubcommandArgs(args, 'branch', 'rename'));
			case 'gitlens.git.branch.setMergeTarget':
				return this.execute(getSubcommandArgs(args, 'branch', 'mergeTarget'));
			case 'gitlens.git.branch.setUpstream':
				return this.execute(getSubcommandArgs(args, 'branch', 'upstream'));
			case 'gitlens.git.cherryPick':
				return this.execute({ command: 'cherry-pick', ...args });
			case 'gitlens.git.history':
				return this.execute({ command: 'log', ...args });
			case 'gitlens.git.merge':
				return this.execute({ command: 'merge', ...args });
			case 'gitlens.git.rebase':
				return this.execute({ command: 'rebase', ...args });
			case 'gitlens.git.remote':
				return this.execute({ command: 'remote', ...args });
			case 'gitlens.git.remote.add':
				return this.execute(getSubcommandArgs(args, 'remote', 'add'));
			case 'gitlens.git.remote.prune':
				return this.execute(getSubcommandArgs(args, 'remote', 'prune'));
			case 'gitlens.git.remote.remove':
				return this.execute(getSubcommandArgs(args, 'remote', 'remove'));
			case 'gitlens.git.reset':
				return this.execute({ command: 'reset', ...args });
			case 'gitlens.git.revert':
				return this.execute({ command: 'revert', ...args });
			case 'gitlens.git.show':
				return this.execute({ command: 'show', ...args });
			case 'gitlens.git.stash':
				return this.execute({ command: 'stash', ...args });
			case 'gitlens.git.stash.drop':
				return this.execute(getSubcommandArgs(args, 'stash', 'drop'));
			case 'gitlens.git.stash.list':
				return this.execute(getSubcommandArgs(args, 'stash', 'list'));
			case 'gitlens.git.stash.pop':
				return this.execute(getSubcommandArgs(args, 'stash', 'pop'));
			case 'gitlens.git.stash.push':
				return this.execute(getSubcommandArgs(args, 'stash', 'push'));
			case 'gitlens.git.stash.rename':
				return this.execute(getSubcommandArgs(args, 'stash', 'rename'));
			case 'gitlens.git.status':
				return this.execute({ command: 'status', ...args });
			case 'gitlens.git.switch':
			case 'gitlens.git.checkout':
				return this.execute({ command: 'switch', ...args });
			case 'gitlens.git.tag':
				return this.execute({ command: 'tag', ...args });
			case 'gitlens.git.tag.create':
				return this.execute(getSubcommandArgs(args, 'tag', 'create'));
			case 'gitlens.git.tag.delete':
				return this.execute(getSubcommandArgs(args, 'tag', 'delete'));
			case 'gitlens.git.worktree':
				return this.execute({ command: 'worktree', ...args });
			case 'gitlens.git.worktree.copyWorkingChangesTo':
			case 'gitlens.copyWorkingChangesToWorktree':
				return this.execute({
					command: 'worktree',
					state: { subcommand: 'copy-changes', changes: { type: 'working-tree' } },
				});
			case 'gitlens.git.worktree.create':
				return this.execute(getSubcommandArgs(args, 'worktree', 'create'));
			case 'gitlens.git.worktree.delete':
				return this.execute(getSubcommandArgs(args, 'worktree', 'delete'));
			case 'gitlens.git.worktree.open':
				return this.execute(getSubcommandArgs(args, 'worktree', 'open'));

			default:
				return this.execute(args);
		}
	}

	override async execute(args?: QuickWizardCommandArgsWithCompletion<GitWizardCommandArgs>): Promise<void> {
		return super.execute(args, this.container.git.isDiscoveringRepositories);
	}
}

function getSubcommandArgs<
	TCommand extends string,
	TSubcommand extends string,
	TArgs extends { command: TCommand; state?: { subcommand?: string } },
>(
	args: QuickWizardCommandArgsWithCompletion<GitWizardCommandArgs> | undefined,
	command: TCommand,
	subcommand: TSubcommand,
): { command: TCommand; state: { subcommand: TSubcommand } } {
	if (args?.command == null) {
		return { command: command, state: { subcommand: subcommand } };
	}

	const typedArgs = args as TArgs;
	if (typedArgs.state?.subcommand != null && typedArgs.state.subcommand !== subcommand) {
		throw new Error(`Invalid subcommand: expected '${subcommand}', got '${typedArgs.state.subcommand}'`);
	}

	return { ...typedArgs, command: command, state: { ...typedArgs.state, subcommand: subcommand } };
}
