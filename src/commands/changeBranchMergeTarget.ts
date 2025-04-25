import type { Container } from '../container';
import type { GitBranch } from '../git/models/branch';
import type { Repository } from '../git/models/repository';
import type { PartialStepState, StepGenerator } from './quickCommand';
import { QuickCommand, StepResultBreak } from './quickCommand';
import { pickBranchOrTagStep } from './quickCommand.steps';

interface Context {
	repos: Repository[];
	title: string;
}

type State = {
	repo: string | Repository;
	branch: string;
	mergeBranch: string | undefined;
};

export interface ChangeBranchMergeTargetCommandArgs {
	readonly command: 'changeBranchMergeTarget';
	state?: Partial<State>;
}

export class ChangeBranchMergeTargetCommand extends QuickCommand {
	constructor(container: Container, args?: ChangeBranchMergeTargetCommandArgs) {
		super(container, 'changeBranchMergeTarget', 'changeBranchMergeTarget', 'Change Merge Target', {
			description: 'Change Merge Target for a branch',
		});
		this.initialState = {
			counter: 0,
			...args?.state,
		};
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: this.container.git.openRepositories,
			title: this.title,
		};
		const repository = typeof state.repo === 'string' ? this.container.git.getRepository(state.repo) : state.repo;
		if (repository) {
			const result = yield* pickBranchOrTagStep({ counter: 0, repo: repository }, context, {
				picked: state.mergeBranch,
				placeholder: 'Pick a merge target branch',
				value: undefined,
				filter: {
					branches: (branch: GitBranch) => branch.remote && branch.name !== state.branch,
					tags: () => false,
				},
			});
			if (result === StepResultBreak) {
				return;
			}
			const ref = await this.container.git.branches(repository.path).getBranch(state.branch);
			if (ref && result && state.branch) {
				await this.container.git
					.branches(repository.path)
					.setUserMergeTargetBranchName?.(state.branch, result.name);
			}
		}

		await Promise.resolve(true);
	}
}
