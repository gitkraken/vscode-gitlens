import { Commands } from '../constants.commands';
import type { Container } from '../container';
import type { LaunchpadCommandArgs } from '../plus/launchpad/launchpad';
import { command } from '../system/vscode/command';
import type { CommandContext } from './base';
import type { QuickWizardCommandArgsWithCompletion } from './quickWizard.base';
import { QuickWizardCommandBase } from './quickWizard.base';

export type QuickWizardCommandArgs = LaunchpadCommandArgs;

@command()
export class QuickWizardCommand extends QuickWizardCommandBase {
	constructor(container: Container) {
		super(container, [Commands.ShowLaunchpad]);
	}

	protected override preExecute(
		context: CommandContext,
		args?: QuickWizardCommandArgsWithCompletion<QuickWizardCommandArgs>,
	) {
		switch (context.command) {
			case Commands.ShowLaunchpad:
				return this.execute({ command: 'launchpad', ...args });

			default:
				return this.execute(args);
		}
	}
}
