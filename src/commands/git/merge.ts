'use strict';
import { Container } from '../../container';
import { GitBranch, GitLog, GitReference, GitRevision, Repository } from '../../git/git';
import {
	appendReposToTitle,
	PartialStepState,
	pickBranchOrTagStep,
	pickCommitStep,
	pickRepositoryStep,
	QuickCommand,
	QuickCommandButtons,
	QuickPickStep,
	StepGenerator,
	StepResult,
	StepResultGenerator,
	StepSelection,
	StepState,
} from '../quickCommand';
import { Directive, DirectiveQuickPickItem, FlagsQuickPickItem } from '../../quickpicks';
import { Strings } from '../../system';

interface Context {
	repos: Repository[];
	cache: Map<string, Promise<GitLog | undefined>>;
	destination: GitBranch;
	pickCommit: boolean;
	selectedBranchOrTag: GitReference | undefined;
	showTags: boolean;
	title: string;
}

type Flags = '--ff-only' | '--no-ff' | '--squash';

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
	constructor(args?: MergeGitCommandArgs) {
		super('merge', 'merge', 'Merge', {
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

	get canSkipConfirm(): boolean {
		return false;
	}

	execute(state: MergeStepState) {
		return state.repo.merge(...state.flags, state.reference.ref);
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: [...(await Container.git.getOrderedRepositories())],
			cache: new Map<string, Promise<GitLog | undefined>>(),
			destination: undefined!,
			pickCommit: false,
			selectedBranchOrTag: undefined,
			showTags: true,
			title: this.title,
		};

		if (state.flags == null) {
			state.flags = [];
		}

		while (this.canStepsContinue(state)) {
			context.title = this.title;

			if (state.counter < 1 || state.repo == null || typeof state.repo === 'string') {
				if (context.repos.length === 1) {
					if (state.repo == null) {
						state.counter++;
					}
					state.repo = context.repos[0];
				} else {
					const result = yield* pickRepositoryStep(state, context);
					// Always break on the first step (so we will go back)
					if (result === StepResult.Break) break;

					state.repo = result;
				}
			}

			if (context.destination == null) {
				const branch = await state.repo.getBranch();
				if (branch == null) break;

				context.destination = branch;
			}

			context.title = `${this.title} into ${GitReference.toString(context.destination, { icon: false })}`;

			if (state.counter < 2 || state.reference == null) {
				const pickCommitToggle = new QuickCommandButtons.PickCommitToggle(context.pickCommit, context, () => {
					context.pickCommit = !context.pickCommit;
					pickCommitToggle.on = context.pickCommit;
				});

				const result: StepResult<GitReference> = yield* pickBranchOrTagStep(state as MergeStepState, context, {
					placeholder: context => `Choose a branch${context.showTags ? ' or tag' : ''} to merge`,
					picked: context.selectedBranchOrTag?.ref,
					value: context.selectedBranchOrTag == null ? state.reference?.ref : undefined,
					additionalButtons: [pickCommitToggle],
				});
				if (result === StepResult.Break) {
					// If we skipped the previous step, make sure we back up past it
					if (context.repos.length === 1) {
						state.counter--;
					}

					continue;
				}

				state.reference = result;
				context.selectedBranchOrTag = undefined;
			}

			if (!GitReference.isRevision(state.reference)) {
				context.selectedBranchOrTag = state.reference;
			}

			if (
				state.counter < 3 &&
				context.selectedBranchOrTag != null &&
				(context.pickCommit || state.reference.ref === context.destination.ref)
			) {
				const ref = context.selectedBranchOrTag.ref;

				let log = context.cache.get(ref);
				if (log == null) {
					log = Container.git.getLog(state.repo.path, { ref: ref, merges: false });
					context.cache.set(ref, log);
				}

				const result: StepResult<GitReference> = yield* pickCommitStep(state as MergeStepState, context, {
					ignoreFocusOut: true,
					log: await log,
					onDidLoadMore: log => context.cache.set(ref, Promise.resolve(log)),
					placeholder: (context, log) =>
						log == null
							? `No commits found on ${GitReference.toString(context.selectedBranchOrTag, {
									icon: false,
							  })}`
							: `Choose a commit to merge into ${GitReference.toString(context.destination, {
									icon: false,
							  })}`,
					picked: state.reference?.ref,
				});
				if (result === StepResult.Break) continue;

				state.reference = result;
			}

			const result = yield* this.confirmStep(state as MergeStepState, context);
			if (result === StepResult.Break) continue;

			state.flags = result;

			QuickCommand.endSteps(state);
			this.execute(state as MergeStepState);
		}

		return state.counter < 0 ? StepResult.Break : undefined;
	}

	private async *confirmStep(state: MergeStepState, context: Context): StepResultGenerator<Flags[]> {
		const count =
			(await Container.git.getCommitCount(state.repo.path, [
				GitRevision.createRange(context.destination.name, state.reference.name),
			])) ?? 0;
		if (count === 0) {
			const step: QuickPickStep<DirectiveQuickPickItem> = this.createConfirmStep(
				appendReposToTitle(`Confirm ${context.title}`, state, context),
				[],
				DirectiveQuickPickItem.create(Directive.Cancel, true, {
					label: `Cancel ${this.title}`,
					detail: `${GitReference.toString(context.destination, {
						capitalize: true,
					})} is up to date with ${GitReference.toString(state.reference)}`,
				}),
			);
			const selection: StepSelection<typeof step> = yield step;
			QuickCommand.canPickStepContinue(step, state, selection);
			return StepResult.Break;
		}

		const step: QuickPickStep<FlagsQuickPickItem<Flags>> = this.createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			[
				FlagsQuickPickItem.create<Flags>(state.flags, [], {
					label: this.title,
					detail: `Will merge ${Strings.pluralize('commit', count)} from ${GitReference.toString(
						state.reference,
					)} into ${GitReference.toString(context.destination)}`,
				}),
				FlagsQuickPickItem.create<Flags>(state.flags, ['--ff-only'], {
					label: `Fast-forward ${this.title}`,
					description: '--ff-only',
					detail: `Will fast-forward merge ${Strings.pluralize('commit', count)} from ${GitReference.toString(
						state.reference,
					)} into ${GitReference.toString(context.destination)}`,
				}),
				FlagsQuickPickItem.create<Flags>(state.flags, ['--no-ff'], {
					label: `No Fast-forward ${this.title}`,
					description: '--no-ff',
					detail: `Will create a merge commit when merging ${Strings.pluralize(
						'commit',
						count,
					)} from ${GitReference.toString(state.reference)} into ${GitReference.toString(
						context.destination,
					)}`,
				}),
				FlagsQuickPickItem.create<Flags>(state.flags, ['--squash'], {
					label: `Squash ${this.title}`,
					description: '--squash',
					detail: `Will squash ${Strings.pluralize('commit', count)} from ${GitReference.toString(
						state.reference,
					)} into one when merging into ${GitReference.toString(context.destination)}`,
				}),
			],
		);
		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
	}
}
