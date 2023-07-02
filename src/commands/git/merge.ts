import type { Container } from '../../container';
import type { GitBranch } from '../../git/models/branch';
import type { GitLog } from '../../git/models/log';
import type { GitReference } from '../../git/models/reference';
import { createRevisionRange, getReferenceLabel, isRevisionReference } from '../../git/models/reference';
import type { Repository } from '../../git/models/repository';
import type { DirectiveQuickPickItem } from '../../quickpicks/items/directive';
import { createDirectiveQuickPickItem, Directive } from '../../quickpicks/items/directive';
import type { FlagsQuickPickItem } from '../../quickpicks/items/flags';
import { createFlagsQuickPickItem } from '../../quickpicks/items/flags';
import { pluralize } from '../../system/string';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase';
import type {
	AsyncStepResultGenerator,
	PartialStepState,
	QuickPickStep,
	StepGenerator,
	StepResult,
	StepSelection,
	StepState,
} from '../quickCommand';
import {
	appendReposToTitle,
	canPickStepContinue,
	endSteps,
	pickBranchOrTagStep,
	pickCommitStep,
	PickCommitToggleQuickInputButton,
	pickRepositoryStep,
	QuickCommand,
	StepResultBreak,
} from '../quickCommand';

interface Context {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	cache: Map<string, Promise<GitLog | undefined>>;
	destination: GitBranch;
	pickCommit: boolean;
	pickCommitForItem: boolean;
	selectedBranchOrTag: GitReference | undefined;
	showTags: boolean;
	title: string;
}

type Flags = '--ff-only' | '--no-ff' | '--squash' | '--no-commit';

interface State {
	repo: string | Repository;
	reference: GitReference;
	flags: Flags[];
}

export interface MergeGitCommandArgs {
	readonly command: 'merge';
	state?: Partial<State>;
}

type MergeStepState<T extends State = State> = ExcludeSome<StepState<T>, 'repo', string>;

export class MergeGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: MergeGitCommandArgs) {
		super(container, 'merge', 'merge', 'Merge', {
			description: 'integrates changes from a specified branch into the current branch',
		});

		let counter = 0;
		if (args?.state?.repo != null) {
			counter++;
		}

		if (args?.state?.reference != null) {
			counter++;
		}

		this.initialState = {
			counter: counter,
			confirm: true,
			...args?.state,
		};
	}

	override get canSkipConfirm(): boolean {
		return false;
	}

	execute(state: MergeStepState) {
		return state.repo.merge(...state.flags, state.reference.ref);
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: this.container.git.openRepositories,
			associatedView: this.container.commitsView,
			cache: new Map<string, Promise<GitLog | undefined>>(),
			destination: undefined!,
			pickCommit: false,
			pickCommitForItem: false,
			selectedBranchOrTag: undefined,
			showTags: true,
			title: this.title,
		};

		if (state.flags == null) {
			state.flags = [];
		}

		let skippedStepOne = false;

		while (this.canStepsContinue(state)) {
			context.title = this.title;

			if (state.counter < 1 || state.repo == null || typeof state.repo === 'string') {
				skippedStepOne = false;
				if (context.repos.length === 1) {
					skippedStepOne = true;
					if (state.repo == null) {
						state.counter++;
					}

					state.repo = context.repos[0];
				} else {
					const result = yield* pickRepositoryStep(state, context);
					// Always break on the first step (so we will go back)
					if (result === StepResultBreak) break;

					state.repo = result;
				}
			}

			if (context.destination == null) {
				const branch = await state.repo.getBranch();
				if (branch == null) break;

				context.destination = branch;
			}

			context.title = `${this.title} into ${getReferenceLabel(context.destination, {
				icon: false,
			})}`;
			context.pickCommitForItem = false;

			if (state.counter < 2 || state.reference == null) {
				const pickCommitToggle = new PickCommitToggleQuickInputButton(context.pickCommit, context, () => {
					context.pickCommit = !context.pickCommit;
					pickCommitToggle.on = context.pickCommit;
				});

				const result: StepResult<GitReference> = yield* pickBranchOrTagStep(state as MergeStepState, context, {
					placeholder: context => `Choose a branch${context.showTags ? ' or tag' : ''} to merge`,
					picked: context.selectedBranchOrTag?.ref,
					value: context.selectedBranchOrTag == null ? state.reference?.ref : undefined,
					additionalButtons: [pickCommitToggle],
				});
				if (result === StepResultBreak) {
					// If we skipped the previous step, make sure we back up past it
					if (skippedStepOne) {
						state.counter--;
					}

					continue;
				}

				state.reference = result;
				context.selectedBranchOrTag = undefined;
			}

			if (!isRevisionReference(state.reference)) {
				context.selectedBranchOrTag = state.reference;
			}

			if (
				state.counter < 3 &&
				context.selectedBranchOrTag != null &&
				(context.pickCommit || context.pickCommitForItem || state.reference.ref === context.destination.ref)
			) {
				const ref = context.selectedBranchOrTag.ref;

				let log = context.cache.get(ref);
				if (log == null) {
					log = this.container.git.getLog(state.repo.path, { ref: ref, merges: false });
					context.cache.set(ref, log);
				}

				const result: StepResult<GitReference> = yield* pickCommitStep(state as MergeStepState, context, {
					ignoreFocusOut: true,
					log: await log,
					onDidLoadMore: log => context.cache.set(ref, Promise.resolve(log)),
					placeholder: (context, log) =>
						log == null
							? `No commits found on ${getReferenceLabel(context.selectedBranchOrTag, {
									icon: false,
							  })}`
							: `Choose a commit to merge into ${getReferenceLabel(context.destination, {
									icon: false,
							  })}`,
					picked: state.reference?.ref,
				});
				if (result === StepResultBreak) continue;

				state.reference = result;
			}

			const result = yield* this.confirmStep(state as MergeStepState, context);
			if (result === StepResultBreak) continue;

			state.flags = result;

			endSteps(state);
			this.execute(state as MergeStepState);
		}

		return state.counter < 0 ? StepResultBreak : undefined;
	}

	private async *confirmStep(state: MergeStepState, context: Context): AsyncStepResultGenerator<Flags[]> {
		const aheadBehind = await this.container.git.getAheadBehindCommitCount(state.repo.path, [
			createRevisionRange(context.destination.name, state.reference.name),
		]);
		const count = aheadBehind != null ? aheadBehind.ahead + aheadBehind.behind : 0;
		if (count === 0) {
			const step: QuickPickStep<DirectiveQuickPickItem> = this.createConfirmStep(
				appendReposToTitle(`Confirm ${context.title}`, state, context),
				[],
				createDirectiveQuickPickItem(Directive.Cancel, true, {
					label: `Cancel ${this.title}`,
					detail: `${getReferenceLabel(context.destination, {
						capitalize: true,
					})} is up to date with ${getReferenceLabel(state.reference)}`,
				}),
			);
			const selection: StepSelection<typeof step> = yield step;
			canPickStepContinue(step, state, selection);
			return StepResultBreak;
		}

		const step: QuickPickStep<FlagsQuickPickItem<Flags>> = this.createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			[
				createFlagsQuickPickItem<Flags>(state.flags, [], {
					label: this.title,
					detail: `Will merge ${pluralize('commit', count)} from ${getReferenceLabel(
						state.reference,
					)} into ${getReferenceLabel(context.destination)}`,
				}),
				createFlagsQuickPickItem<Flags>(state.flags, ['--ff-only'], {
					label: `Fast-forward ${this.title}`,
					description: '--ff-only',
					detail: `Will fast-forward merge ${pluralize('commit', count)} from ${getReferenceLabel(
						state.reference,
					)} into ${getReferenceLabel(context.destination)}`,
				}),
				createFlagsQuickPickItem<Flags>(state.flags, ['--squash'], {
					label: `Squash ${this.title}`,
					description: '--squash',
					detail: `Will squash ${pluralize('commit', count)} from ${getReferenceLabel(
						state.reference,
					)} into one when merging into ${getReferenceLabel(context.destination)}`,
				}),
				createFlagsQuickPickItem<Flags>(state.flags, ['--no-ff'], {
					label: `${this.title} without Fast-Forwarding`,
					description: '--no-ff',
					detail: `Will create a merge commit when merging ${pluralize(
						'commit',
						count,
					)} from ${getReferenceLabel(state.reference)} into ${getReferenceLabel(context.destination)}`,
				}),
				createFlagsQuickPickItem<Flags>(state.flags, ['--no-ff', '--no-commit'], {
					label: `${this.title} without Fast-Forwarding or Committing`,
					description: '--no-ff --no-commit',
					detail: `Will merge ${pluralize('commit', count)} from ${getReferenceLabel(
						state.reference,
					)} into ${getReferenceLabel(context.destination)} without Committing`,
				}),
			],
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}
}
