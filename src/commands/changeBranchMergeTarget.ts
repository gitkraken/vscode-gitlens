import { ThemeIcon } from 'vscode';
import type { Container } from '../container';
import type { GitBranch } from '../git/models/branch';
import type { Repository } from '../git/models/repository';
import type { ViewsWithRepositoryFolders } from '../views/viewBase';
import type { PartialStepState, StepGenerator, StepState } from './quickCommand';
import { endSteps, QuickCommand, StepResultBreak } from './quickCommand';
import { pickBranchStep, pickOrResetBranchStep, pickRepositoryStep } from './quickCommand.steps';

interface Context {
	repos: Repository[];
	title: string;
	associatedView: ViewsWithRepositoryFolders;
}

type InitialState = {
	repo: string | Repository;
	branch: string;
	mergeBranch: string | undefined;
};

type State = {
	repo: Repository;
	branch: string;
	mergeBranch: string | undefined;
};
function assertState(state: PartialStepState<InitialState>): asserts state is StepState<State> {
	if (!state.repo || typeof state.repo === 'string') {
		throw new Error('Invalid state: repo should be a Repository instance');
	}
}

export interface ChangeBranchMergeTargetCommandArgs {
	readonly command: 'changeBranchMergeTarget';
	state?: Partial<InitialState>;
}

export class ChangeBranchMergeTargetCommand extends QuickCommand {
	constructor(container: Container, args?: ChangeBranchMergeTargetCommandArgs) {
		super(container, 'changeBranchMergeTarget', 'changeBranchMergeTarget', 'Change Merge Target', {
			description: 'Change Merge Target for a branch',
		});
		let counter = 0;
		if (args?.state?.repo) {
			counter++;
		}
		if (args?.state?.branch) {
			counter++;
		}
		this.initialState = {
			counter: counter,
			...args?.state,
		};
	}

	protected async *steps(state: PartialStepState<InitialState>): StepGenerator {
		const context: Context = {
			repos: this.container.git.openRepositories,
			title: this.title,
			associatedView: this.container.views.branches,
		};

		while (this.canStepsContinue(state)) {
			if (state.counter < 1 || !state.repo || typeof state.repo === 'string') {
				const result = yield* pickRepositoryStep(state, context);
				if (result === StepResultBreak) break;

				state.repo = result;
			}

			assertState(state);

			if (state.counter < 2 || !state.branch) {
				const branches = yield* pickBranchStep(state, context, {
					picked: state.branch,
					placeholder: 'Pick a branch to edit',
					filter: (branch: GitBranch) => !branch.remote,
				});
				if (branches === StepResultBreak) continue;

				state.branch = branches.name;
			}

			const svc = this.container.git.getRepositoryService(state.repo.uri);
			if (!state.mergeBranch) {
				state.mergeBranch = await svc.branches.getBaseBranchName?.(state.branch);
			}

			const detectedMergeTarget = await svc.branches.getStoredDetectedMergeTargetBranchName?.(state.branch);
			const userMergeTarget = await svc.branches.getStoredUserMergeTargetBranchName?.(state.branch);

			const result = yield* pickOrResetBranchStep(state, context, {
				picked: state.mergeBranch,
				placeholder: 'Pick a merge target branch',
				filter: (branch: GitBranch) => branch.remote && branch.name !== state.branch,
				reset:
					userMergeTarget != null && detectedMergeTarget !== userMergeTarget
						? {
								label: 'Reset Merge Target',
								detail: 'Reset the merge target branch to be automatically detected',
								button: { icon: new ThemeIcon('discard'), tooltip: 'Reset Merge Target' },
							}
						: undefined,
			});
			if (result === StepResultBreak) continue;

			if (state.branch) {
				await svc.branches.storeUserMergeTargetBranchName?.(state.branch, result?.name);
			}

			endSteps(state);
		}
	}
}
