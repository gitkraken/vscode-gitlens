import type { Container } from '../container.js';
import type { LaunchpadCommandArgs } from '../plus/launchpad/launchpad.js';
import type { StartReviewCommandArgs } from '../plus/launchpad/startReview.js';
import type { AssociateIssueWithBranchCommandArgs } from '../plus/startWork/associateIssueWithBranch.js';
import type { StartWorkCommandArgs } from '../plus/startWork/startWork.js';
import { command } from '../system/-webview/command.js';
import type { CommandContext } from './commandContext.js';
import type { QuickWizardCommandArgsWithCompletion } from './quick-wizard/models/quickWizard.js';
import { QuickWizardCommandBase } from './quick-wizard/quickWizardCommandBase.js';

export type QuickWizardCommandArgs =
	| LaunchpadCommandArgs
	| StartReviewCommandArgs
	| StartWorkCommandArgs
	| AssociateIssueWithBranchCommandArgs;

@command()
export class QuickWizardCommand extends QuickWizardCommandBase {
	constructor(container: Container) {
		super(container, [
			'gitlens.showLaunchpad',
			'gitlens.startReview',
			'gitlens.startWork',
			'gitlens.associateIssueWithBranch',
		]);
	}

	protected override preExecute(context: CommandContext, args?: QuickWizardCommandArgsWithCompletion): Promise<void> {
		switch (context.command) {
			case 'gitlens.showLaunchpad':
				return this.execute({ command: 'launchpad', ...args });

			case 'gitlens.startReview':
				return this.execute({ command: 'startReview', ...args });

			case 'gitlens.startWork':
				return this.execute({ command: 'startWork', ...args });

			case 'gitlens.associateIssueWithBranch':
				return this.execute({ command: 'associateIssueWithBranch', ...args });

			default:
				return this.execute(args);
		}
	}
}
