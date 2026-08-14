import { ThemeIcon, window } from 'vscode';
import { MergeError, SigningError } from '@gitlens/git/errors.js';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { GitLog } from '@gitlens/git/models/log.js';
import type { ConflictDetectionResult } from '@gitlens/git/models/mergeConflicts.js';
import type { GitReference } from '@gitlens/git/models/reference.js';
import { parseGitBoolean } from '@gitlens/git/utils/config.utils.js';
import { getReferenceLabel, isRevisionReference } from '@gitlens/git/utils/reference.utils.js';
import { createRevisionRange } from '@gitlens/git/utils/revision.utils.js';
import { Logger } from '@gitlens/utils/logger.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { Container } from '../../container.js';
import { showPausedOperationStatus } from '../../git/actions/pausedOperation.js';
import type { GlRepository } from '../../git/models/repository.js';
import { showGitErrorMessage } from '../../messages.js';
import { isSubscriptionTrialOrPaidFromState } from '../../plus/gk/utils/subscription.utils.js';
import { createQuickPickSeparator } from '../../quickpicks/items/common.js';
import type { ConfirmToggleQuickPickItem, DirectiveQuickPickItem } from '../../quickpicks/items/directive.js';
import {
	createConfirmToggleQuickPickItem,
	createDirectiveQuickPickItem,
	Directive,
} from '../../quickpicks/items/directive.js';
import type { FlagsQuickPickItem } from '../../quickpicks/items/flags.js';
import { createFlagsQuickPickItem } from '../../quickpicks/items/flags.js';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase.js';
import type {
	AsyncStepResultGenerator,
	PartialStepState,
	StepGenerator,
	StepResult,
	StepsContext,
	StepSelection,
	StepState,
} from '../quick-wizard/models/steps.js';
import { StepResultBreak } from '../quick-wizard/models/steps.js';
import type { QuickPickStep } from '../quick-wizard/models/steps.quickpick.js';
import { QuickCommand } from '../quick-wizard/quickCommand.js';
import { pickCommitStep } from '../quick-wizard/steps/commits.js';
import { pickBranchOrTagStep } from '../quick-wizard/steps/references.js';
import { canSkipRepositoryPick, pickRepositoryStep } from '../quick-wizard/steps/repositories.js';
import { StepsController } from '../quick-wizard/stepsController.js';
import {
	appendReposToTitle,
	assertStepState,
	canPickStepContinue,
	refreshConfirmStepItems,
} from '../quick-wizard/utils/steps.utils.js';

const Steps = {
	PickRepo: 'merge-pick-repo',
	PickBranchOrTag: 'merge-pick-branch-or-tag',
	PickCommit: 'merge-pick-commit',
	Confirm: 'merge-confirm',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];

interface Context extends StepsContext<StepNames> {
	repos: GlRepository[];
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
interface State<Repo = string | GlRepository> {
	repo: Repo;
	reference: GitReference;
	flags: Flags[];
}

export interface MergeGitCommandArgs {
	readonly command: 'merge';
	state?: Partial<State>;
}

export class MergeGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: MergeGitCommandArgs) {
		super(container, 'merge', 'merge', 'Merge', {
			description: 'integrates changes from a specified branch into the current branch',
		});

		this.initialState = { confirm: true, ...args?.state };
	}

	override get canSkipConfirm(): boolean {
		return false;
	}

	private async execute(state: StepState<State<GlRepository>>) {
		const options: { fastForward?: boolean | 'only'; noCommit?: boolean; squash?: boolean } = {};

		if (state.flags.includes('--ff-only')) {
			options.fastForward = 'only';
		} else if (state.flags.includes('--no-ff')) {
			options.fastForward = false;
		}
		if (state.flags.includes('--squash')) {
			options.squash = true;
		}
		if (state.flags.includes('--no-commit')) {
			options.noCommit = true;
		}

		this.container.telemetry.sendEvent('gitCommand/run', { command: 'merge' });

		try {
			const result = await state.repo.git.ops?.merge(state.reference.ref, options);
			if (result?.conflicted) {
				void window.showWarningMessage(
					'Unable to merge due to conflicts. Resolve the conflicts before continuing, or abort the merge.',
				);
				void showPausedOperationStatus(this.container, state.repo.path, { source: { source: 'quick-wizard' } });
			}
		} catch (ex) {
			// Don't show an error message if the user intentionally aborted the merge
			if (MergeError.is(ex, 'aborted')) {
				Logger.debug(ex.message, this.title);
				return;
			}

			Logger.error(ex, this.title);

			if (MergeError.is(ex, 'uncommittedChanges') || MergeError.is(ex, 'wouldOverwriteChanges')) {
				void window.showWarningMessage(
					'Unable to merge. Your local changes would be overwritten. Please commit or stash your changes before trying again.',
				);
				return;
			}

			if (MergeError.is(ex, 'alreadyInProgress')) {
				void window.showWarningMessage(
					'Unable to merge. A merge is already in progress. Continue or abort the current merge first.',
				);
				void showPausedOperationStatus(this.container, state.repo.path, { source: { source: 'quick-wizard' } });
				return;
			}

			void showGitErrorMessage(ex, MergeError.is(ex) || SigningError.is(ex) ? undefined : 'Unable to merge');
		}
	}

	protected createContext(context?: StepsContext<any>): Context {
		return {
			...context,
			container: this.container,
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.commits,
			cache: new Map<string, Promise<GitLog | undefined>>(),
			destination: undefined!,
			pickCommit: false,
			pickCommitForItem: false,
			selectedBranchOrTag: undefined,
			showTags: true,
			title: this.title,
		};
	}

	protected async *steps(state: PartialStepState<State>, context?: Context): StepGenerator {
		context ??= this.createContext();
		using steps = new StepsController<StepNames>(context, this);

		state.flags ??= [];

		while (!steps.isComplete) {
			context.title = this.title;

			if (steps.isAtStep(Steps.PickRepo) || state.repo == null || typeof state.repo === 'string') {
				// Skip the picker only when the sole available repo is the one requested
				if (canSkipRepositoryPick(context.repos, state.repo)) {
					[state.repo] = context.repos;
				} else {
					using step = steps.enterStep(Steps.PickRepo);

					const result = yield* pickRepositoryStep(state, context, step);
					if (result === StepResultBreak) {
						state.repo = undefined!;
						if (step.goBack() == null) break;
						continue;
					}

					state.repo = result;
				}
			}

			assertStepState<State<GlRepository>>(state);

			if (context.destination == null) {
				const branch = await state.repo.git.branches.getBranch();
				if (branch == null) break;

				context.destination = branch;
			}

			context.title = `${this.title} into ${getReferenceLabel(context.destination, {
				icon: false,
				label: false,
			})}`;
			context.pickCommitForItem = false;

			if (steps.isAtStep(Steps.PickBranchOrTag) || state.reference == null) {
				using step = steps.enterStep(Steps.PickBranchOrTag);

				// A worded row at the top of the ref list rather than the old icon-only title-bar toggle —
				// a modifier that changes what the next step does should say so where it can be read
				const pickCommitRow = createConfirmToggleQuickPickItem({
					label: 'Choose a Specific Commit',
					detail: 'After choosing the branch, pick the exact commit to merge',
					checked: context.pickCommit,
					onDidChange: (item, quickpick) => {
						context.pickCommit = item.checked;
						quickpick.items = [...quickpick.items];
					},
				});

				const result: StepResult<GitReference> = yield* pickBranchOrTagStep(state, context, {
					placeholder: context => `Choose a branch${context.showTags ? ' or tag' : ''} to merge`,
					picked: context.selectedBranchOrTag?.ref,
					value: context.selectedBranchOrTag == null ? state.reference?.ref : undefined,
					prependItems: [pickCommitRow, createQuickPickSeparator()],
				});
				if (result === StepResultBreak) {
					state.reference = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				state.reference = result;
				context.selectedBranchOrTag = undefined;
			}

			if (!isRevisionReference(state.reference)) {
				context.selectedBranchOrTag = state.reference;
			}

			if (
				context.selectedBranchOrTag != null &&
				(steps.isAtStep(Steps.PickCommit) ||
					context.pickCommit ||
					context.pickCommitForItem ||
					state.reference.ref === context.destination.ref)
			) {
				using step = steps.enterStep(Steps.PickCommit);

				const rev = context.selectedBranchOrTag.ref;

				let log = context.cache.get(rev);
				if (log == null) {
					log = state.repo.git.commits.getLog(rev, { merges: 'first-parent' });
					context.cache.set(rev, log);
				}

				const result: StepResult<GitReference> = yield* pickCommitStep(state, context, {
					emptyItems: [
						createDirectiveQuickPickItem(Directive.Cancel, true, {
							label: 'OK',
							detail: `No commits found on ${getReferenceLabel(context.selectedBranchOrTag, { icon: false })}`,
						}),
					],
					ignoreFocusOut: true,
					log: await log,
					onDidLoadMore: log => context.cache.set(rev, Promise.resolve(log)),
					placeholder: (context, log) =>
						!log?.commits.size
							? `No commits found on ${getReferenceLabel(context.selectedBranchOrTag, { icon: false })}`
							: `Choose a commit to merge into ${getReferenceLabel(context.destination, { icon: false })}`,
					picked: state.reference?.ref,
				});
				if (result === StepResultBreak) {
					if (step.goBack() == null) break;
					continue;
				}

				state.reference = result;
			}

			{
				using step = steps.enterStep(Steps.Confirm);

				const result = yield* this.confirmStep(state, context);
				if (result === StepResultBreak) {
					state.flags = [];
					if (step.goBack() == null) break;
					continue;
				}

				state.flags = result;
			}

			steps.markStepsComplete();

			void this.execute(state);
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	private async *confirmStep(
		state: StepState<State<GlRepository>>,
		context: Context,
	): AsyncStepResultGenerator<Flags[]> {
		const counts = await state.repo.git.commits.getLeftRightCommitCount(
			createRevisionRange(context.destination.ref, state.reference.ref, '...'),
		);

		const title = `Merge ${getReferenceLabel(state.reference, { icon: false, label: false })} into ${getReferenceLabel(context.destination, { icon: false, label: false })} `;
		const count = counts != null ? counts.right : 0;
		if (count === 0) {
			const step: QuickPickStep<DirectiveQuickPickItem> = this.createConfirmStep(
				appendReposToTitle(`Confirm ${title}`, state, context),
				[],
				createDirectiveQuickPickItem(Directive.Cancel, true, {
					label: 'OK',
					detail: `${getReferenceLabel(context.destination, {
						capitalize: true,
						label: false,
					})} is already up to date with ${getReferenceLabel(state.reference, { label: false })}`,
				}),
				{
					placeholder: `Nothing to merge; ${getReferenceLabel(context.destination, {
						label: false,
						icon: false,
					})} is already up to date`,
				},
			);
			const selection: StepSelection<typeof step> = yield step;
			canPickStepContinue(step, state, selection);
			return StepResultBreak;
		}

		// Fast-forward is tri-state: a seeded wizard flag wins; otherwise, for the pair that doesn't already
		// force a merge commit on its own, the `merge.ff` config decides, so the toggle reflects what git
		// will actually do if left untouched.
		let ff: 0 | 1 | 2;
		if (state.flags.includes('--ff-only')) {
			ff = 1;
		} else if (state.flags.includes('--no-ff') && !state.flags.includes('--no-commit')) {
			ff = 2;
		} else {
			const raw = await state.repo.git.config.getConfig?.('merge.ff');
			if (raw?.trim().toLowerCase() === 'only') {
				ff = 1;
			} else {
				ff = parseGitBoolean(raw) === false ? 2 : 0;
			}
		}
		let noCommit = state.flags.includes('--no-commit');
		// Don't Commit requires a merge commit, so it snaps Fast-forward to Never (and cycling
		// Fast-forward away from Never unchecks Don't Commit) — states cascade, never silently override
		if (noCommit) {
			ff = 2;
		}

		const sourceLabel = getReferenceLabel(state.reference, { label: false });
		const destinationLabel = getReferenceLabel(context.destination, { label: false });
		const commitsLabel = pluralize('commit', count);

		const ffLabels = ['If Possible', 'Required', 'Never'] as const;
		const ffDetails = [
			'Fast-forward when possible, otherwise create a merge commit',
			'Only fast-forward — fail rather than create a merge commit',
			'Always create a merge commit',
		] as const;
		const ffIcons = ['gitlens-checkbox-mixed', 'gitlens-checkbox-checked', 'gitlens-checkbox-unchecked'] as const;
		const ffClauses = [
			', fast-forwarding if possible',
			', only if it can fast-forward',
			', always creating a merge commit',
		] as const;

		// Folds the live Fast-forward/Don't Commit control values into each mode's flags and detail — the
		// accepted item's flags are the whole contract with `execute()` — so the list says what will
		// actually happen.
		const buildItems = (): FlagsQuickPickItem<Flags>[] => {
			const mergeFlags: Flags[] = noCommit
				? ['--no-commit', '--no-ff']
				: ff === 1
					? ['--ff-only']
					: ff === 2
						? ['--no-ff']
						: [];

			return [
				createFlagsQuickPickItem<Flags>(state.flags, mergeFlags, {
					label: this.title,
					description: mergeFlags.length ? mergeFlags.join(' ') : undefined,
					detail: `Will merge ${commitsLabel} from ${sourceLabel} into ${destinationLabel}${ffClauses[ff]}${
						noCommit ? ', stopping before committing' : ''
					}`,
					picked: !state.flags.includes('--squash'),
				}),
				createFlagsQuickPickItem<Flags>(state.flags, ['--squash'], {
					label: `Squash ${this.title}`,
					description: `--squash${
						noCommit
							? ' · already stops before committing'
							: ff !== 0
								? ' · not affected — no merge commit involved'
								: ''
					}`,
					detail: `Will combine ${commitsLabel} from ${sourceLabel} into one set of staged changes, stopping before committing`,
					picked: state.flags.includes('--squash'),
				}),
			];
		};

		let items = buildItems();

		let step: QuickPickStep<DirectiveQuickPickItem | FlagsQuickPickItem<Flags>>;

		const notices: DirectiveQuickPickItem[] = [];

		interface Toggles {
			ff?: DirectiveQuickPickItem;
			noCommit?: ConfirmToggleQuickPickItem;
		}
		// A mutable holder rather than separate variables so each control's handler can reach the other
		// without forward-referencing a not-yet-declared `const` (an `eslint(no-use-before-define)` build
		// error) — both properties are always populated below before `buildRows` is ever called.
		const toggles: Toggles = {};

		/** Every row the confirm step shows, minus the separator + Cancel that `createConfirmStep` appends. */
		const buildRows = (): (FlagsQuickPickItem<Flags> | DirectiveQuickPickItem)[] => [
			...notices,
			...items,
			createQuickPickSeparator('Options'),
			toggles.ff!,
			toggles.noCommit!,
		];

		const updateFfRow = (): void => {
			const row = toggles.ff!;
			row.description = ffLabels[ff];
			row.detail = ffDetails[ff];
			row.iconPath = new ThemeIcon(ffIcons[ff]);
		};

		toggles.ff = createDirectiveQuickPickItem(Directive.Noop, false, {
			label: 'Fast-forward',
			description: ffLabels[ff],
			detail: ffDetails[ff],
			iconPath: new ThemeIcon(ffIcons[ff]),
			onDidSelect: () => {
				ff = ((ff + 1) % 3) as 0 | 1 | 2;
				updateFfRow();
				// Anything other than Never can't stop before committing — cycling away unchecks Don't Commit
				if (ff !== 2 && noCommit) {
					noCommit = false;
					toggles.noCommit!.checked = false;
					toggles.noCommit!.iconPath = new ThemeIcon('gitlens-checkbox-unchecked');
				}
				items = buildItems();
				refreshConfirmStepItems(step, buildRows());
			},
		});

		toggles.noCommit = createConfirmToggleQuickPickItem({
			label: "Don't Commit",
			description: '--no-commit',
			detail: 'Stop before committing so the result can be reviewed or edited',
			checked: noCommit,
			onDidChange: item => {
				noCommit = item.checked;
				// A stop point needs a merge commit — checking snaps Fast-forward to Never
				if (noCommit && ff !== 2) {
					ff = 2;
					updateFfRow();
				}
				items = buildItems();
				refreshConfirmStepItems(step, buildRows());
			},
		});

		let potentialConflict: Promise<ConflictDetectionResult | undefined> | undefined;
		const subscription = await this.container.subscription.getSubscription();
		if (isSubscriptionTrialOrPaidFromState(subscription?.state)) {
			potentialConflict = state.repo.git.branches.getPotentialMergeConflicts?.(
				state.reference.name,
				context.destination.name,
			);
		}

		if (potentialConflict) {
			void potentialConflict?.then(result => {
				if (result == null || result.status === 'clean') {
					notices.splice(
						0,
						1,
						createDirectiveQuickPickItem(Directive.Noop, false, {
							label: 'No Conflicts Detected',
							iconPath: new ThemeIcon('check'),
						}),
					);
				} else if (result.status === 'error') {
					notices.splice(
						0,
						1,
						createDirectiveQuickPickItem(Directive.Noop, false, {
							label: 'Unable to Detect Conflicts',
							detail: result.message,
							iconPath: new ThemeIcon('error'),
						}),
					);
				} else {
					notices.splice(
						0,
						1,
						createDirectiveQuickPickItem(Directive.Noop, false, {
							label: 'Conflicts Detected',
							detail: `Will result in ${pluralize(
								'conflicting file',
								result.conflict.files.length,
							)} that will need to be resolved`,
							iconPath: new ThemeIcon('warning'),
						}),
					);
				}

				refreshConfirmStepItems(step, buildRows());
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

		step = this.createConfirmStep(appendReposToTitle(`Confirm ${title}`, state, context), buildRows());
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}
}
