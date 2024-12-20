import type { StoredRecentUsage } from '../constants.storage';
import type { Container } from '../container';
import { LaunchpadCommand } from '../plus/launchpad/launchpad';
import { AssociateIssueWithBranchCommand, StartWorkCommand } from '../plus/startWork/startWork';
import { configuration } from '../system/vscode/configuration';
import { getContext } from '../system/vscode/context';
import { BranchGitCommand } from './git/branch';
import { CherryPickGitCommand } from './git/cherry-pick';
import { CoAuthorsGitCommand } from './git/coauthors';
import { FetchGitCommand } from './git/fetch';
import { LogGitCommand } from './git/log';
import { MergeGitCommand } from './git/merge';
import { PullGitCommand } from './git/pull';
import { PushGitCommand } from './git/push';
import { RebaseGitCommand } from './git/rebase';
import { RemoteGitCommand } from './git/remote';
import { ResetGitCommand } from './git/reset';
import { RevertGitCommand } from './git/revert';
import { SearchGitCommand } from './git/search';
import { ShowGitCommand } from './git/show';
import { StashGitCommand } from './git/stash';
import { StatusGitCommand } from './git/status';
import { SwitchGitCommand } from './git/switch';
import { TagGitCommand } from './git/tag';
import { WorktreeGitCommand } from './git/worktree';
import type { QuickCommand, QuickPickStep, StepGenerator } from './quickCommand';
import type { AnyQuickWizardCommandArgs } from './quickWizard.base';

function* nullSteps(): StepGenerator {
	/* noop */
}

export function getSteps(
	container: Container,
	args: AnyQuickWizardCommandArgs,
	pickedVia: 'menu' | 'command',
): StepGenerator {
	const rootStep = new QuickWizardRootStep(container, args);

	const command = rootStep.find(args.command);
	if (command == null) return nullSteps();

	rootStep.setCommand(command, pickedVia);

	return command.executeSteps();
}

export class QuickWizardRootStep implements QuickPickStep<QuickCommand> {
	readonly type = 'pick';
	readonly buttons = [];
	ignoreFocusOut = false;
	readonly items: QuickCommand[];
	readonly matchOnDescription = true;
	readonly placeholder: string = 'Choose a command';
	readonly title: string = 'GitLens';

	private readonly hiddenItems: QuickCommand[];

	constructor(
		private readonly container: Container,
		args?: AnyQuickWizardCommandArgs,
	) {
		const hasVirtualFolders = getContext('gitlens:hasVirtualFolders', false);
		const readonly =
			hasVirtualFolders || getContext('gitlens:readonly', false) || getContext('gitlens:untrusted', false);

		this.items = [
			readonly ? undefined : new BranchGitCommand(container, args?.command === 'branch' ? args : undefined),
			readonly
				? undefined
				: new CherryPickGitCommand(container, args?.command === 'cherry-pick' ? args : undefined),
			hasVirtualFolders
				? undefined
				: new CoAuthorsGitCommand(container, args?.command === 'co-authors' ? args : undefined),
			readonly ? undefined : new FetchGitCommand(container, args?.command === 'fetch' ? args : undefined),
			new LogGitCommand(container, args?.command === 'log' ? args : undefined),
			readonly ? undefined : new MergeGitCommand(container, args?.command === 'merge' ? args : undefined),
			readonly ? undefined : new PullGitCommand(container, args?.command === 'pull' ? args : undefined),
			readonly ? undefined : new PushGitCommand(container, args?.command === 'push' ? args : undefined),
			readonly ? undefined : new RebaseGitCommand(container, args?.command === 'rebase' ? args : undefined),
			readonly ? undefined : new RemoteGitCommand(container, args?.command === 'remote' ? args : undefined),
			readonly ? undefined : new ResetGitCommand(container, args?.command === 'reset' ? args : undefined),
			readonly ? undefined : new RevertGitCommand(container, args?.command === 'revert' ? args : undefined),
			new SearchGitCommand(container, args?.command === 'search' || args?.command === 'grep' ? args : undefined),

			new ShowGitCommand(container, args?.command === 'show' ? args : undefined),
			hasVirtualFolders
				? undefined
				: new StashGitCommand(container, args?.command === 'stash' ? args : undefined),
			hasVirtualFolders
				? undefined
				: new StatusGitCommand(container, args?.command === 'status' ? args : undefined),
			readonly
				? undefined
				: new SwitchGitCommand(
						container,
						args?.command === 'switch' || args?.command === 'checkout' ? args : undefined,
				  ),
			readonly ? undefined : new TagGitCommand(container, args?.command === 'tag' ? args : undefined),
			hasVirtualFolders
				? undefined
				: new WorktreeGitCommand(container, args?.command === 'worktree' ? args : undefined),
		].filter(<T>(i: T | undefined): i is T => i != null);

		if (configuration.get('gitCommands.sortBy') === 'usage') {
			const usage = container.storage.getWorkspace('gitComandPalette:usage');
			if (usage != null) {
				this.items.sort((a, b) => (usage[b.key] ?? 0) - (usage[a.key] ?? 0));
			}
		}

		this.hiddenItems = [];
		if (args?.command === 'launchpad') {
			this.hiddenItems.push(new LaunchpadCommand(container, args));
		}

		if (args?.command === 'startWork') {
			this.hiddenItems.push(new StartWorkCommand(container, args));
		}

		if (args?.command === 'associateIssueWithBranch') {
			this.hiddenItems.push(new AssociateIssueWithBranchCommand(container, args));
		}
	}

	private _command: QuickCommand | undefined;
	get command(): QuickCommand | undefined {
		return this._command;
	}

	find(commandName: string, fuzzy: boolean = false) {
		if (fuzzy) {
			const cmd = commandName.toLowerCase();
			return this.items.find(c => c.isFuzzyMatch(cmd)) ?? this.hiddenItems.find(c => c.isFuzzyMatch(cmd));
		}

		return this.items.find(c => c.isMatch(commandName)) ?? this.hiddenItems.find(c => c.isMatch(commandName));
	}

	setCommand(command: QuickCommand | undefined, via: 'menu' | 'command'): void {
		if (this._command != null) {
			this._command.picked = false;
		}

		if (command != null) {
			command.picked = true;
			command.pickedVia = via;
		}

		this._command = command;
		if (command != null) {
			void this.updateCommandUsage(command.key, Date.now());
		}
	}

	private async updateCommandUsage(id: string, timestamp: number) {
		let usage = this.container.storage.getWorkspace(`gitComandPalette:usage`);
		if (usage === undefined) {
			usage = Object.create(null) as StoredRecentUsage;
		}

		usage[id] = timestamp;
		await this.container.storage.storeWorkspace(`gitComandPalette:usage`, usage);
	}
}
