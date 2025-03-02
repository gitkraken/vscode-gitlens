import type { Container } from '../container';
import type { LaunchpadCommandArgs } from '../plus/launchpad/launchpad';
import type { AssociateIssueWithBranchCommandArgs, StartWorkCommandArgs } from '../plus/startWork/startWork';
import { command } from '../system/-webview/command';
import type { CommandContext } from './commandContext';
import type { QuickWizardCommandArgsWithCompletion } from './quickWizard.base';
import { QuickWizardCommandBase } from './quickWizard.base';

export type QuickWizardCommandArgs = LaunchpadCommandArgs | StartWorkCommandArgs | AssociateIssueWithBranchCommandArgs;

@command()
export class QuickWizardCommand extends QuickWizardCommandBase {
	constructor(container: Container) {
		super(container, ['gitlens.showLaunchpad', 'gitlens.startWork', 'gitlens.associateIssueWithBranch']);
	}

	protected override preExecute(context: CommandContext, args?: QuickWizardCommandArgsWithCompletion): Promise<void> {
		switch (context.command) {
			case 'gitlens.showLaunchpad':
				return this.execute({ command: 'launchpad', ...args });

			case 'gitlens.startWork':
				return this.execute({ command: 'startWork', ...args });

			case 'gitlens.associateIssueWithBranch':
				return this.execute({ command: 'associateIssueWithBranch', ...args });

			default:
				return this.execute(args);
		}
	}
}
