import type { AsyncStepResultGenerator } from '../../commands/quick-wizard/models/steps.js';
import { getSteps } from '../../commands/quick-wizard/utils/quickWizard.utils.js';
import type { Sources } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import type { GitBranch } from '../../git/models/branch.js';
import type { GitWorktree } from '../../git/models/worktree.js';
import type { Deferred } from '../../system/promise.js';
import type { StartWorkContext, StartWorkStepState } from './startWorkBase.js';
import { StartWorkBaseCommand } from './startWorkBase.js';
import { createBranchNameFromIssue } from './utils/-webview/startWork.utils.js';

export interface StartWorkCommandArgs {
	readonly command: 'startWork';
	source?: Sources;

	// Pre-select issue by URL (skips issue picker)
	issueUrl?: string;

	// Use smart defaults and skip unnecessary steps
	useDefaults?: boolean;

	// Result tracking for programmatic usage
	result?: Deferred<{ branch: GitBranch; worktree?: GitWorktree }>;
}

export class StartWorkCommand extends StartWorkBaseCommand {
	overrides?: undefined;

	constructor(container: Container, args?: StartWorkCommandArgs) {
		super(container, args);

		// Populate initialState with args for CLI/programmatic usage
		this.initialState = {
			...this.initialState,
			issueUrl: args?.issueUrl,
			useDefaults: args?.useDefaults,
			result: args?.result,
		};
	}

	protected override async *continuation(
		state: StartWorkStepState,
		context: StartWorkContext,
	): AsyncStepResultGenerator<void> {
		const issue = state.item.issue;
		const repo = issue && (await this.getIssueRepositoryIfExists(issue));

		// Determine defaults when useDefaults is enabled
		let defaultReference;

		if (state.useDefaults && repo) {
			// Get default branch
			const defaultBranchName = await repo.git.branches.getDefaultBranchName();
			if (defaultBranchName) {
				const defaultBranch = await repo.git.branches.getBranch(defaultBranchName);
				if (defaultBranch) {
					defaultReference = defaultBranch;
				}
			}
		}

		const branchName = issue ? createBranchNameFromIssue(issue) : undefined;

		yield* getSteps(
			this.container,
			{
				command: 'branch',
				state: {
					subcommand: 'create',
					// When useDefaults is true, set repo directly to skip picker
					// Otherwise, use suggestedRepo to hint at the picker
					repo: state.useDefaults ? repo : undefined,
					suggestedRepo: state.useDefaults ? undefined : repo,
					reference: defaultReference,
					name: state.useDefaults ? branchName : undefined,
					suggestedName: branchName,
					flags: state.useDefaults ? ['--worktree'] : [],
					confirmOptions: ['--switch', '--worktree'],
					associateWithIssue: issue,
					worktreeDefaultOpen: state.useDefaults ? 'new' : undefined,
					result: state.result,
					startWorkIssue: issue,
				},
			},
			context,
			this.startedFrom,
		);
	}
}
