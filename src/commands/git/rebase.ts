import { ThemeIcon } from 'vscode';
import type { Container } from '../../container';
import type { GitBranch } from '../../git/models/branch';
import type { GitLog } from '../../git/models/log';
import type { GitReference } from '../../git/models/reference';
import { getReferenceLabel, isRevisionReference } from '../../git/models/reference.utils';
import type { Repository } from '../../git/models/repository';
import { createRevisionRange } from '../../git/models/revision.utils';
import { isSubscriptionStatePaidOrTrial } from '../../plus/gk/account/subscription';
import { createQuickPickSeparator } from '../../quickpicks/items/common';
import type { DirectiveQuickPickItem } from '../../quickpicks/items/directive';
import { createDirectiveQuickPickItem, Directive } from '../../quickpicks/items/directive';
import type { FlagsQuickPickItem } from '../../quickpicks/items/flags';
import { createFlagsQuickPickItem } from '../../quickpicks/items/flags';
import { pluralize } from '../../system/string';
import { getEditorCommand } from '../../system/vscode/utils';
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
import { canPickStepContinue, endSteps, QuickCommand, StepResultBreak } from '../quickCommand';
import { PickCommitToggleQuickInputButton } from '../quickCommand.buttons';
import { appendReposToTitle, pickBranchOrTagStep, pickCommitStep, pickRepositoryStep } from '../quickCommand.steps';

interface Context {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	cache: Map<string, Promise<GitLog | undefined>>;
	branch: GitBranch;
	pickCommit: boolean;
	pickCommitForItem: boolean;
	selectedBranchOrTag: GitReference | undefined;
	showTags: boolean;
	title: string;
}

type Flags = '--interactive';

interface State {
	repo: string | Repository;
	destination: GitReference;
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

		if (args?.state?.destination != null) {
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

		state.repo.rebase(configs, ...state.flags, state.destination.ref);
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.commits,
			cache: new Map<string, Promise<GitLog | undefined>>(),
			branch: undefined!,
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

			if (context.branch == null) {
				const branch = await state.repo.git.getBranch();
				if (branch == null) break;

				context.branch = branch;
			}

			context.title = `${this.title} ${getReferenceLabel(context.branch, {
				icon: false,
				label: false,
			})} onto`;
			context.pickCommitForItem = false;

			if (state.counter < 2 || state.destination == null) {
				const pickCommitToggle = new PickCommitToggleQuickInputButton(context.pickCommit, context, () => {
					context.pickCommit = !context.pickCommit;
					pickCommitToggle.on = context.pickCommit;
				});

				const result: StepResult<GitReference> = yield* pickBranchOrTagStep(state as RebaseStepState, context, {
					placeholder: context => `Choose a branch${context.showTags ? ' or tag' : ''} to rebase onto`,
					picked: context.selectedBranchOrTag?.ref,
					value: context.selectedBranchOrTag == null ? state.destination?.ref : undefined,
					additionalButtons: [pickCommitToggle],
				});
				if (result === StepResultBreak) {
					// If we skipped the previous step, make sure we back up past it
					if (skippedStepOne) {
						state.counter--;
					}

					continue;
				}

				state.destination = result;
				context.selectedBranchOrTag = undefined;
			}

			if (!isRevisionReference(state.destination)) {
				context.selectedBranchOrTag = state.destination;
			}

			if (
				state.counter < 3 &&
				context.selectedBranchOrTag != null &&
				(context.pickCommit || context.pickCommitForItem || state.destination.ref === context.branch.ref)
			) {
				const ref = context.selectedBranchOrTag.ref;

				let log = context.cache.get(ref);
				if (log == null) {
					log = this.container.git.getLog(state.repo.path, { ref: ref, merges: 'first-parent' });
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
							: `Choose a commit to rebase ${getReferenceLabel(context.branch, {
									icon: false,
							  })} onto`,
					picked: state.destination?.ref,
				});
				if (result === StepResultBreak) continue;

				state.destination = result;
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
		const counts = await this.container.git.getLeftRightCommitCount(
			state.repo.path,
			createRevisionRange(state.destination.ref, context.branch.ref, '...'),
			{ excludeMerges: true },
		);

		const title = `${context.title} ${getReferenceLabel(state.destination, { icon: false, label: false })}`;
		const ahead = counts != null ? counts.right : 0;
		const behind = counts != null ? counts.left : 0;
		if (behind === 0 && ahead === 0) {
			const step: QuickPickStep<DirectiveQuickPickItem> = this.createConfirmStep(
				appendReposToTitle(title, state, context),
				[],
				createDirectiveQuickPickItem(Directive.Cancel, true, {
					label: 'OK',
					detail: `${getReferenceLabel(context.branch, {
						capitalize: true,
					})} is already up to date with ${getReferenceLabel(state.destination, { label: false })}`,
				}),
				{
					placeholder: `Nothing to rebase; ${getReferenceLabel(context.branch, {
						label: false,
						icon: false,
					})} is already up to date`,
				},
			);
			const selection: StepSelection<typeof step> = yield step;
			canPickStepContinue(step, state, selection);
			return StepResultBreak;
		}

		const items: FlagsQuickPickItem<Flags>[] = [
			createFlagsQuickPickItem<Flags>(state.flags, ['--interactive'], {
				label: `Interactive ${this.title}`,
				description: '--interactive',
				detail: `Will interactively update ${getReferenceLabel(context.branch, {
					label: false,
				})} by applying ${pluralize('commit', ahead)} on top of ${getReferenceLabel(state.destination, {
					label: false,
				})}`,
				picked: behind === 0,
			}),
		];

		if (behind > 0) {
			items.unshift(
				createFlagsQuickPickItem<Flags>(state.flags, [], {
					label: this.title,
					detail: `Will update ${getReferenceLabel(context.branch, {
						label: false,
					})} by applying ${pluralize('commit', ahead)} on top of ${getReferenceLabel(state.destination, {
						label: false,
					})}`,
					picked: true,
				}),
			);
		}

		let potentialConflict;
		const subscription = await this.container.subscription.getSubscription();
		if (isSubscriptionStatePaidOrTrial(subscription?.state)) {
			potentialConflict = this.container.git.getPotentialMergeOrRebaseConflict(
				state.repo.path,
				context.branch.name,
				state.destination.ref,
			);
		}

		let step: QuickPickStep<DirectiveQuickPickItem | FlagsQuickPickItem<Flags>>;

		const notices: DirectiveQuickPickItem[] = [];
		if (potentialConflict) {
			void potentialConflict?.then(conflict => {
				notices.splice(
					0,
					1,
					conflict == null
						? createDirectiveQuickPickItem(Directive.Noop, false, {
								label: 'No Conflicts Detected',
								iconPath: new ThemeIcon('check'),
						  })
						: createDirectiveQuickPickItem(Directive.Noop, false, {
								label: 'Conflicts Detected',
								detail: `Will result in ${pluralize(
									'conflicting file',
									conflict.files.length,
								)} that will need to be resolved`,
								iconPath: new ThemeIcon('warning'),
						  }),
				);

				if (step.quickpick != null) {
					const active = step.quickpick.activeItems;
					step.quickpick.items = [...notices, ...items];
					step.quickpick.activeItems = active;
				}
			});

			notices.push(
				createDirectiveQuickPickItem(Directive.Noop, false, {
					label: `$(loading~spin) \u00a0Detecting Conflicts...`,
					// Don't use this, because the spin here causes the icon to spin incorrectly
					//iconPath: new ThemeIcon('loading~spin'),
				}),
				createQuickPickSeparator(),
			);
		}

		step = this.createConfirmStep(appendReposToTitle(`Confirm ${title}`, state, context), [...notices, ...items]);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}
}
