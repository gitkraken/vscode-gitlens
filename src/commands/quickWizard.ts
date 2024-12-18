import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import type { LaunchpadCommandArgs } from '../plus/launchpad/launchpad';
import type { AddIssueToBranchCommandArgs, StartWorkCommandArgs } from '../plus/startWork/startWork';
import { command } from '../system/vscode/command';
import type { CommandContext } from './base';
import type { QuickWizardCommandArgsWithCompletion } from './quickWizard.base';
import { QuickWizardCommandBase } from './quickWizard.base';

export type QuickWizardCommandArgs = LaunchpadCommandArgs | StartWorkCommandArgs | AddIssueToBranchCommandArgs;

@command()
export class QuickWizardCommand extends QuickWizardCommandBase {
	constructor(container: Container) {
		super(container, [GlCommand.ShowLaunchpad, GlCommand.StartWork, GlCommand.AddIssueToBranch]);
	}

	protected override preExecute(
		context: CommandContext,
		args?: QuickWizardCommandArgsWithCompletion<QuickWizardCommandArgs>,
	) {
		switch (context.command) {
			case GlCommand.ShowLaunchpad:
				return this.execute({ command: 'launchpad', ...args });

			case GlCommand.StartWork:
				return this.execute({ command: 'startWork', ...args });

			case GlCommand.AddIssueToBranch:
				return this.execute({ command: 'addIssueToBranch', ...args });

			default:
				return this.execute(args);
		}
	}
}
