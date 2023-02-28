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
import { getEditorCommand } from '../../system/utils';
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

type Flags = '--interactive';

interface State {
	repo: string | Repository;
	reference: GitReference;
	flags: Flags[];
}

export interface RebaseGitCommandArgs {
	readonly command: 'rebase';
	state?: Partial<State>;
}

type RebaseStepState<T extends State = State> = ExcludeSome<StepState<T>, 'repo', string>;

export class RebaseGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: RebaseGitCommandArgs) {
		super(container, 'rebase', 'rebase', 'Rebase', {
			description:
				'integrates changes from a specified branch into the current branch, by changing the base of the branch and reapplying the commits on top',
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

	async execute(state: RebaseStepState) {
		let configs: string[] | undefined;
		if (state.flags.includes('--interactive')) {
			await this.container.rebaseEditor.enableForNextUse();

			const editor = getEditorCommand();
			configs = ['-c', `"sequence.editor=${editor}"`];
		}
		return state.repo.rebase(configs, ...state.flags, state.reference.ref);
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

			context.title = `${this.title} ${getReferenceLabel(context.destination, { icon: false })}`;
			context.pickCommitForItem = false;

			if (state.counter < 2 || state.reference == null) {
				const pickCommitToggle = new PickCommitToggleQuickInputButton(context.pickCommit, context, () => {
					context.pickCommit = !context.pickCommit;
					pickCommitToggle.on = context.pickCommit;
				});

				const result: StepResult<GitReference> = yield* pickBranchOrTagStep(state as RebaseStepState, context, {
					placeholder: context => `Choose a branch${context.showTags ? ' or tag' : ''} to rebase`,
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

				const result: StepResult<GitReference> = yield* pickCommitStep(state as RebaseStepState, context, {
					ignoreFocusOut: true,
					log: await log,
					onDidLoadMore: log => context.cache.set(ref, Promise.resolve(log)),
					placeholder: (context, log) =>
						log == null
							? `No commits found on ${getReferenceLabel(context.selectedBranchOrTag, {
									icon: false,
							  })}`
							: `Choose a commit to rebase ${getReferenceLabel(context.destination, {
									icon: false,
							  })} onto`,
					picked: state.reference?.ref,
				});
				if (result === StepResultBreak) continue;

				state.reference = result;
			}

			const result = yield* this.confirmStep(state as RebaseStepState, context);
			if (result === StepResultBreak) continue;

			state.flags = result;

			endSteps(state);
			void this.execute(state as RebaseStepState);
		}

		return state.counter < 0 ? StepResultBreak : undefined;
	}

	private async *confirmStep(state: RebaseStepState, context: Context): AsyncStepResultGenerator<Flags[]> {
		const aheadBehind = await this.container.git.getAheadBehindCommitCount(state.repo.path, [
			state.reference.refType === 'revision'
				? createRevisionRange(state.reference.ref, context.destination.ref)
				: createRevisionRange(context.destination.name, state.reference.name),
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
					detail: `Will update ${getReferenceLabel(context.destination)} by applying ${pluralize(
						'commit',
						count,
					)} on top of ${getReferenceLabel(state.reference)}`,
				}),
				createFlagsQuickPickItem<Flags>(state.flags, ['--interactive'], {
					label: `Interactive ${this.title}`,
					description: '--interactive',
					detail: `Will interactively update ${getReferenceLabel(
						context.destination,
					)} by applying ${pluralize('commit', count)} on top of ${getReferenceLabel(state.reference)}`,
				}),
			],
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}
}
