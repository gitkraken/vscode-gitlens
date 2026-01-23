import type { AsyncStepResultGenerator } from '../../commands/quick-wizard/models/steps.js';
import { getSteps } from '../../commands/quick-wizard/utils/quickWizard.utils.js';
import type { Sources } from '../../constants.telemetry.js';
import type { StartWorkContext, StartWorkStepState } from './startWorkBase.js';
import { StartWorkBaseCommand } from './startWorkBase.js';
import { createBranchNameFromIssue } from './utils/-webview/startWork.utils.js';

export interface StartWorkCommandArgs {
	readonly command: 'startWork';
	source?: Sources;
}

export class StartWorkCommand extends StartWorkBaseCommand {
	overrides?: undefined;

	protected override async *continuation(
		state: StartWorkStepState,
		context: StartWorkContext,
	): AsyncStepResultGenerator<void> {
		const issue = state.item.issue;
		const repo = issue && (await this.getIssueRepositoryIfExists(issue));

		yield* getSteps(
			this.container,
			{
				command: 'branch',
				state: {
					subcommand: 'create',
					suggestedRepo: repo,
					suggestedName: issue ? createBranchNameFromIssue(issue) : undefined,
					confirmOptions: ['--switch', '--worktree'],
					associateWithIssue: issue,
				},
			},
			context,
			this.startedFrom,
		);
	}
}
