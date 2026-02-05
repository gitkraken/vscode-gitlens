import type { AsyncStepResultGenerator } from '../../commands/quick-wizard/models/steps.js';
import { getSteps } from '../../commands/quick-wizard/utils/quickWizard.utils.js';
import type { Sources } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import type { GitBranch } from '../../git/models/branch.js';
import type { GitWorktree } from '../../git/models/worktree.js';
import { getBranchNameWithoutRemote } from '../../git/utils/branch.utils.js';
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

	// Open chat on after branch/worktree is opened
	openChatOnComplete?: boolean;

	// Instructions to include in the AI prompt
	instructions?: string;

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
			instructions: args?.instructions,
			useDefaults: args?.useDefaults,
			openChatOnComplete: args?.openChatOnComplete,
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
		let defaultReference = undefined;

		if (state.useDefaults && repo) {
			// Get default branch (returns remote branch name like "origin/main")
			const defaultBranchName = await repo.git.branches.getDefaultBranchName();
			if (defaultBranchName) {
				// Strip remote prefix to get local branch name (e.g., "origin/main" -> "main")
				const localBranchName = getBranchNameWithoutRemote(defaultBranchName);

				// Get the local version of the default branch
				const defaultBranch = await repo.git.branches.getBranch(localBranchName);
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
				confirm: state.useDefaults ? false : undefined,
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
					chatAction:
						state.openChatOnComplete && issue
							? {
									type: 'startWork',
									issue: issue,
									instructions: state.instructions,
								}
							: undefined,
				},
			},
			context,
			this.startedFrom,
		);
	}
}
