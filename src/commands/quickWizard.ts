import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import type { LaunchpadCommandArgs } from '../plus/launchpad/launchpad';
import type { AssociateIssueWithBranchCommandArgs, StartWorkCommandArgs } from '../plus/startWork/startWork';
import { command } from '../system/vscode/command';
import type { CommandContext } from './base';
import type { QuickWizardCommandArgsWithCompletion } from './quickWizard.base';
import { QuickWizardCommandBase } from './quickWizard.base';

export type QuickWizardCommandArgs = LaunchpadCommandArgs | StartWorkCommandArgs | AssociateIssueWithBranchCommandArgs;

@command()
export class QuickWizardCommand extends QuickWizardCommandBase {
	constructor(container: Container) {
		super(container, [GlCommand.ShowLaunchpad, GlCommand.StartWork, GlCommand.AssociateIssueWithBranch]);
	}

	protected override preExecute(context: CommandContext, args?: QuickWizardCommandArgsWithCompletion) {
		switch (context.command) {
			case GlCommand.ShowLaunchpad:
				return this.execute({ command: 'launchpad', ...args });

			case GlCommand.StartWork:
				return this.execute({ command: 'startWork', ...args });

			case GlCommand.AssociateIssueWithBranch:
				return this.execute({ command: 'associateIssueWithBranch', ...args });

			default:
				return this.execute(args);
		}
	}
}
