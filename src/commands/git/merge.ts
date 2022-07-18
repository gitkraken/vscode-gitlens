import * as nls from 'vscode-nls';
import type { Container } from '../../container';
import type { GitBranch } from '../../git/models/branch';
import type { GitLog } from '../../git/models/log';
import { GitReference, GitRevision } from '../../git/models/reference';
import type { Repository } from '../../git/models/repository';
import { Directive, DirectiveQuickPickItem } from '../../quickpicks/items/directive';
import { FlagsQuickPickItem } from '../../quickpicks/items/flags';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase';
import type {
	AsyncStepResultGenerator,
	PartialStepState,
	QuickPickStep,
	StepGenerator,
	StepSelection,
	StepState,
} from '../quickCommand';
import {
	appendReposToTitle,
	pickBranchOrTagStep,
	pickCommitStep,
	pickRepositoryStep,
	QuickCommand,
	QuickCommandButtons,
	StepResult,
} from '../quickCommand';

const localize = nls.loadMessageBundle();
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
		super(container, 'merge', localize('label', 'merge'), localize('title', 'Merge'), {
			description: localize('description', 'integrates changes from a specified branch into the current branch'),
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
			context.pickCommitForItem = false;

			if (state.counter < 2 || state.reference == null) {
				const pickCommitToggle = new QuickCommandButtons.PickCommitToggle(context.pickCommit, context, () => {
					context.pickCommit = !context.pickCommit;
					pickCommitToggle.on = context.pickCommit;
				});

				const result: StepResult<GitReference> = yield* pickBranchOrTagStep(state as MergeStepState, context, {
					placeholder: context =>
						context.showTags
							? localize(
									'pickBranchOrTagStep.placeholder.chooseBranchOrTagToMerge',
									'Choose a branch or tag to merge',
							  )
							: localize(
									'pickBranchOrTagStep.placeholder.chooseBranchToMerge',
									'Choose a branch to merge',
							  ),
					picked: context.selectedBranchOrTag?.ref,
					value: context.selectedBranchOrTag == null ? state.reference?.ref : undefined,
					additionalButtons: [pickCommitToggle],
				});
				if (result === StepResult.Break) {
					// If we skipped the previous step, make sure we back up past it
					if (skippedStepOne) {
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
							? localize(
									'pickCommitStep.placeholder.noCommitsFoundOnBranchOrTag',
									'No commits found on {0}',
									GitReference.toString(context.selectedBranchOrTag, {
										icon: false,
									}),
							  )
							: localize(
									'pickCommitStep.placeholder.chooseCommitToMergeIntoBranch',
									'Choose a commit to merge into {0}',
									GitReference.toString(context.destination, {
										icon: false,
									}),
							  ),
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

	private async *confirmStep(state: MergeStepState, context: Context): AsyncStepResultGenerator<Flags[]> {
		const aheadBehind = await this.container.git.getAheadBehindCommitCount(state.repo.path, [
			GitRevision.createRange(context.destination.name, state.reference.name),
		]);
		const count = aheadBehind != null ? aheadBehind.ahead + aheadBehind.behind : 0;
		if (count === 0) {
			const step: QuickPickStep<DirectiveQuickPickItem> = this.createConfirmStep(
				appendReposToTitle(localize('comfirm', 'Confirm {0}', context.title), state, context),
				[],
				DirectiveQuickPickItem.create(Directive.Cancel, true, {
					label: localize('quickPick.cancel.label', 'Cancel {0}', this.title),
					detail: localize(
						'quickPick.cancle.detail',
						'{0} is up to date with {1}',
						GitReference.toString(context.destination, {
							capitalize: true,
						}),
						GitReference.toString(state.reference),
					),
				}),
			);
			const selection: StepSelection<typeof step> = yield step;
			QuickCommand.canPickStepContinue(step, state, selection);
			return StepResult.Break;
		}

		const step: QuickPickStep<FlagsQuickPickItem<Flags>> = this.createConfirmStep(
			appendReposToTitle(localize('confirm', 'Confirm {0}', context.title), state, context),
			[
				FlagsQuickPickItem.create<Flags>(state.flags, [], {
					label: this.title,
					detail:
						count === 1
							? localize(
									'quickPick.merge.detail.willMergeOneCommitFromRefIntoBranch',
									'Will merge 1 commit from {0} into {1}',
									GitReference.toString(state.reference),
									GitReference.toString(context.destination),
							  )
							: localize(
									'quickPick.merge.detail.willMergeCommitsFromRefIntoBranch',
									'Will merge {0} commits from {1} into {2}',
									count,
									GitReference.toString(state.reference),
									GitReference.toString(context.destination),
							  ),
				}),
				FlagsQuickPickItem.create<Flags>(state.flags, ['--ff-only'], {
					label: localize('quickPick.fastForward.label', 'Fast-forward {0}', this.title),
					description: '--ff-only',
					detail:
						count === 1
							? localize(
									'quickPick.fastForward.detail.willFastForwardMergeOneCommitFromRefIntoBranch',
									'Will fast-forward merge 1 commit from {0} into {1}',
									GitReference.toString(state.reference),
									GitReference.toString(context.destination),
							  )
							: localize(
									'quickPick.fastForward.detail.willFastForwardMergeCommitsFromRefIntoBranch',
									'Will fast-forward merge {0} commits from {1} into {2}',
									count,
									GitReference.toString(state.reference),
									GitReference.toString(context.destination),
							  ),
				}),
				FlagsQuickPickItem.create<Flags>(state.flags, ['--squash'], {
					label: localize('quickPick.squash.label', 'Squash {0}', this.title),
					description: '--squash',
					detail:
						count === 1
							? localize(
									'quickPick.squash.detail.willSquashOneCommitFromRefWhenMergingIntoBranch',
									'Will squash 1 commit from {0} into one when merging into {1}',
									GitReference.toString(state.reference),
									GitReference.toString(context.destination),
							  )
							: localize(
									'quickPick.squash.detail.willSquashCommitsFromRefWhenMergingIntoBranch',
									'Will squash {0} commits from {1} into one when merging into {2}',
									count,
									GitReference.toString(state.reference),
									GitReference.toString(context.destination),
							  ),
				}),
				FlagsQuickPickItem.create<Flags>(state.flags, ['--no-ff'], {
					label: localize('quickPick.noff.label', '{0} without Fast-Forwarding', this.title),
					description: '--no-ff',
					detail:
						count === 1
							? localize(
									'quickPick.noff.detail.willCreateMergeCommitWhenMergingOneCommitFromRefToBranch',
									'Will create a merge commit when merging 1 commit from {0} to {1}',
									GitReference.toString(state.reference),
									GitReference.toString(context.destination),
							  )
							: localize(
									'quickPick.noff.detail.willCreateMergeCommitWhenMergingCommitsFromRefToBranch',
									'Will create a merge commit when merging {0} commits from {1} to {2}',
									count,
									GitReference.toString(state.reference),
									GitReference.toString(context.destination),
							  ),
				}),
				FlagsQuickPickItem.create<Flags>(state.flags, ['--no-ff', '--no-commit'], {
					label: localize('quickPick.noffOrCommit', '{0} without Fast-Forwarding or Committing', this.title),
					description: '--no-ff --no-commit',
					detail:
						count === 1
							? localize(
									'quickPick.noffOrCommit.detail.willMergeOneCommitFromRefIntoBranchWithoutCommitting',
									'Will merge 1 commit from {0} into {1} without Committing',
									GitReference.toString(state.reference),
									GitReference.toString(context.destination),
							  )
							: localize(
									'quickPick.noffOrCommit.detail.willMergeCommitsFromRefIntoBranchWithoutCommitting',
									'Will merge {0} commits from {1} into {2} without Committing',
									count,
									GitReference.toString(state.reference),
									GitReference.toString(context.destination),
							  ),
				}),
			],
		);
		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
	}
}
