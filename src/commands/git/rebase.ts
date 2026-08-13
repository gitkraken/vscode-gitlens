import { ThemeIcon, window } from 'vscode';
import { RebaseError, SigningError } from '@gitlens/git/errors.js';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { GitLog } from '@gitlens/git/models/log.js';
import type { ConflictDetectionResult } from '@gitlens/git/models/mergeConflicts.js';
import type { GitReference } from '@gitlens/git/models/reference.js';
import { parseGitBoolean } from '@gitlens/git/utils/config.utils.js';
import { getReferenceLabel, isRevisionReference } from '@gitlens/git/utils/reference.utils.js';
import { createRevisionRange } from '@gitlens/git/utils/revision.utils.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import { Logger } from '@gitlens/utils/logger.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { Container } from '../../container.js';
import { showPausedOperationStatus } from '../../git/actions/pausedOperation.js';
import type { GlRepository } from '../../git/models/repository.js';
import { isRebaseTodoEditorEnabled, reopenRebaseTodoEditor } from '../../git/utils/-webview/rebase.utils.js';
import { showGitErrorMessage } from '../../messages.js';
import { startAutoRebaseRun } from '../../plus/coretools/conflict/autoRebaseProgress.js';
import { isSubscriptionTrialOrPaidFromState } from '../../plus/gk/utils/subscription.utils.js';
import { createQuickPickSeparator } from '../../quickpicks/items/common.js';
import type { DirectiveQuickPickItem } from '../../quickpicks/items/directive.js';
import { createDirectiveQuickPickItem, Directive } from '../../quickpicks/items/directive.js';
import type { FlagsQuickPickItem } from '../../quickpicks/items/flags.js';
import { createFlagsQuickPickItem } from '../../quickpicks/items/flags.js';
import { getHostEditorCommand } from '../../system/-webview/vscode.js';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase.js';
import type {
	AsyncStepResultGenerator,
	PartialStepState,
	StepGenerator,
	StepsContext,
	StepSelection,
	StepState,
} from '../quick-wizard/models/steps.js';
import { StepResultBreak } from '../quick-wizard/models/steps.js';
import type { QuickPickStep } from '../quick-wizard/models/steps.quickpick.js';
import { PickCommitToggleQuickInputButton } from '../quick-wizard/quickButtons.js';
import { QuickCommand } from '../quick-wizard/quickCommand.js';
import { pickCommitStep } from '../quick-wizard/steps/commits.js';
import { pickBranchOrTagStep } from '../quick-wizard/steps/references.js';
import { canSkipRepositoryPick, pickRepositoryStep } from '../quick-wizard/steps/repositories.js';
import { StepsController } from '../quick-wizard/stepsController.js';
import { appendReposToTitle, assertStepState, canPickStepContinue } from '../quick-wizard/utils/steps.utils.js';

const Steps = {
	PickRepo: 'rebase-pick-repo',
	PickBranchOrTag: 'rebase-pick-branch-or-tag',
	PickCommit: 'rebase-pick-commit',
	Confirm: 'rebase-confirm',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];

interface Context extends StepsContext<StepNames> {
	repos: GlRepository[];
	associatedView: ViewsWithRepositoryFolders;
	cache: Map<string, Promise<GitLog | undefined>>;
	branch: GitBranch;
	pickCommit: boolean;
	pickCommitForItem: boolean;
	selectedBranchOrTag: GitReference | undefined;
	showTags: boolean;
	title: string;
}

/** `ai-resolve` is an internal pseudo-flag (never passed to git) — it routes execution through the
 *  automatic rebase service, which resolves any conflicts with AI end-to-end. */
type Flags = '--interactive' | '--update-refs' | 'ai-resolve';
interface State<Repo = string | GlRepository> {
	repo: Repo;
	destination: GitReference;
	flags: Flags[];
}

export interface RebaseGitCommandArgs {
	readonly command: 'rebase';
	state?: Partial<State>;
}

export class RebaseGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: RebaseGitCommandArgs) {
		super(container, 'rebase', 'rebase', 'Rebase', {
			description:
				'integrates changes from a specified branch into the current branch, by changing the base of the branch and reapplying the commits on top',
		});

		this.initialState = { confirm: true, ...args?.state };
	}

	override get canSkipConfirm(): boolean {
		return false;
	}

	private async execute(state: StepState<State<GlRepository>>) {
		const interactive = state.flags.includes('--interactive');
		const updateRefs = state.flags.includes('--update-refs');

		if (state.flags.includes('ai-resolve')) {
			this.container.telemetry.sendEvent('gitCommand/run', { command: 'rebase' });
			const svc = this.container.git.getRepositoryService(state.repo.path);
			// The wizard always rebases the current branch — pass it explicitly so the session record
			// (and the Resolve panel's run header) carries the branch name.
			const branch = (await svc.branches.getBranch())?.name;
			return startAutoRebaseRun(this.container, svc, {
				upstream: state.destination.ref,
				branch: branch,
				updateRefs: updateRefs,
				source: { source: 'quick-wizard' },
			});
		}

		// If the editor is not enabled, listen for the rebase todo file to be opened and then reopen it with our editor
		const disposable =
			interactive && !isRebaseTodoEditorEnabled()
				? window.onDidChangeActiveTextEditor(async e => {
						if (e?.document.uri.path.endsWith('git-rebase-todo')) {
							await reopenRebaseTodoEditor('gitlens.rebase');
							disposable?.dispose();
						}
					})
				: undefined;

		using _ = createDisposable(() => void disposable?.dispose());

		this.container.telemetry.sendEvent('gitCommand/run', { command: 'rebase' });

		try {
			const result = await state.repo.git.ops?.rebase(state.destination.ref, {
				editor: interactive ? await getHostEditorCommand(true) : undefined,
				interactive: interactive,
				updateRefs: updateRefs,
			});
			if (result?.conflicted) {
				void window.showWarningMessage(
					'Unable to rebase due to conflicts. Resolve the conflicts before continuing, or abort the rebase.',
				);
				void showPausedOperationStatus(this.container, state.repo.path, { source: { source: 'quick-wizard' } });
			}
		} catch (ex) {
			// Don't show an error message if the user intentionally aborted the rebase
			if (RebaseError.is(ex, 'aborted')) {
				Logger.debug(ex.message, this.title);
				return;
			}

			Logger.error(ex, this.title);

			if (RebaseError.is(ex, 'uncommittedChanges') || RebaseError.is(ex, 'wouldOverwriteChanges')) {
				void window.showWarningMessage(
					'Unable to rebase. Your local changes would be overwritten. Please commit or stash your changes before trying again.',
				);
				return;
			}

			if (RebaseError.is(ex, 'alreadyInProgress')) {
				void window.showWarningMessage(
					'Unable to rebase. A rebase is already in progress. Continue or abort the current rebase first.',
				);
				void showPausedOperationStatus(this.container, state.repo.path, { source: { source: 'quick-wizard' } });
				return;
			}

			void showGitErrorMessage(ex, RebaseError.is(ex) || SigningError.is(ex) ? undefined : 'Unable to rebase');
		}
	}

	protected createContext(context?: StepsContext<any>): Context {
		return {
			...context,
			container: this.container,
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

			if (context.branch == null) {
				const branch = await state.repo.git.branches.getBranch();
				if (branch == null) break;

				context.branch = branch;
			}

			context.title = `${this.title} ${getReferenceLabel(context.branch, {
				icon: false,
				label: false,
			})} onto`;
			context.pickCommitForItem = false;

			if (steps.isAtStep(Steps.PickBranchOrTag) || state.destination == null) {
				using step = steps.enterStep(Steps.PickBranchOrTag);

				const pickCommitToggle = new PickCommitToggleQuickInputButton(context.pickCommit, context, () => {
					context.pickCommit = !context.pickCommit;
					pickCommitToggle.on = context.pickCommit;
				});

				const result = yield* pickBranchOrTagStep(state, context, {
					placeholder: context => `Choose a branch${context.showTags ? ' or tag' : ''} to rebase onto`,
					picked: context.selectedBranchOrTag?.ref,
					value: context.selectedBranchOrTag == null ? state.destination?.ref : undefined,
					additionalButtons: [pickCommitToggle],
				});
				if (result === StepResultBreak) {
					state.destination = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				state.destination = result;
				context.selectedBranchOrTag = undefined;
			}

			if (!isRevisionReference(state.destination)) {
				context.selectedBranchOrTag = state.destination;
			}

			if (
				context.selectedBranchOrTag != null &&
				(steps.isAtStep(Steps.PickCommit) ||
					context.pickCommit ||
					context.pickCommitForItem ||
					state.destination.ref === context.branch.ref)
			) {
				using step = steps.enterStep(Steps.PickCommit);

				const rev = context.selectedBranchOrTag.ref;

				let log = context.cache.get(rev);
				if (log == null) {
					log = state.repo.git.commits.getLog(rev, { merges: 'first-parent' });
					context.cache.set(rev, log);
				}

				const result = yield* pickCommitStep(state, context, {
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
							: `Choose a commit to rebase ${getReferenceLabel(context.branch, { icon: false })} onto`,
					picked: state.destination?.ref,
				});
				if (result === StepResultBreak) {
					if (step.goBack() == null) break;
					continue;
				}

				state.destination = result;
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
			createRevisionRange(state.destination.ref, context.branch.ref, '...'),
			{ excludeMerges: true },
		);

		const title = `${context.title} ${getReferenceLabel(state.destination, { icon: false, label: false })}`;
		const ahead = counts?.right ?? 0;
		const behind = counts?.left ?? 0;
		if (behind === 0 && ahead === 0) {
			const step: QuickPickStep<DirectiveQuickPickItem> = this.createConfirmStep(
				appendReposToTitle(`Confirm ${title}`, state, context),
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

		const subscription = await this.container.subscription.getSubscription();
		const isTrialOrPaid = isSubscriptionTrialOrPaidFromState(subscription?.state);
		// Automatic rebase is offered only to trial/paid users with AI enabled (settings + org policy),
		// and only when there's something to rebase onto — the same `behind > 0` gate the plain rebase
		// uses, since an ahead-only rebase replays commits with nothing to conflict against.
		const aiOffered = isTrialOrPaid && this.container.ai.enabled && this.container.ai.orgEnabled && behind > 0;

		// If the wizard was seeded with the AI pseudo-flag (`gitlens.ai.autoRebase`) but automatic rebase
		// isn't offered here, strip it — otherwise `aiSeeded` below would suppress the normal
		// `picked` defaults (nothing preselected, so default-Enter silently runs a non-AI rebase) and
		// `execute()` would route an ineligible user straight to the auto-rebase service.
		if (!aiOffered && state.flags.includes('ai-resolve')) {
			state.flags = state.flags.filter(f => f !== 'ai-resolve');
		}

		// When the wizard was seeded with the AI pseudo-flag, let the automatic rebase item take the
		// preselection — otherwise the plain/interactive defaults would steal it and default-Enter
		// would silently run a non-AI rebase.
		const aiSeeded = state.flags.includes('ai-resolve');

		const branchLabel = getReferenceLabel(context.branch, { label: false });
		const destinationLabel = getReferenceLabel(state.destination, { label: false });
		const applying = `by applying ${pluralize('commit', ahead)} on top of ${destinationLabel}`;
		// Appended to whichever mode is chosen while the Update Branches toggle is on — `--update-refs`
		// modifies every mode identically, so it's a toggle rather than a duplicate of each item.
		const updateRefsClause = ', and update any branches pointing to the rebased commits';

		type Mode = { flags: Flags[]; label: string; description?: string; detail: string; picked: boolean };
		const modes: Mode[] = [];

		if (behind > 0) {
			modes.push({
				flags: [],
				label: this.title,
				detail: `Will update ${branchLabel} ${applying}`,
				picked: !aiSeeded,
			});
		}

		// Automatic rebase — AI resolves conflicts at every paused step, stopping for review only when
		// confidence is low. Sits between the plain and interactive rebases: it's the hands-off end of
		// the same axis, while Interactive is the hands-on end.
		if (aiOffered) {
			modes.push({
				flags: ['ai-resolve'],
				label: `Automatic ${this.title}`,
				description: 'AI resolves conflicts · Preview',
				detail: `Will update ${branchLabel} ${applying}, resolving any conflicts with AI and pausing for review only when confidence is low`,
				picked: aiSeeded,
			});
		}

		modes.push({
			flags: ['--interactive'],
			label: `Interactive ${this.title}`,
			description: '--interactive',
			detail: `Will interactively update ${branchLabel} ${applying}`,
			picked: behind === 0 && !aiSeeded,
		});

		// A seeded wizard flag wins; otherwise the user's `rebase.updateRefs` config decides, so the
		// toggle reflects what git will actually do if left untouched.
		const updateRefsConfig = parseGitBoolean(await state.repo.git.config.getConfig?.('rebase.updateRefs')) ?? false;
		let updateRefs = state.flags.includes('--update-refs') || updateRefsConfig;

		// Folds the live toggle value into each item's flags — the accepted item's flags are the whole
		// contract with `execute()` — and into its detail, so the list says what will actually happen.
		const buildItems = (): FlagsQuickPickItem<Flags>[] =>
			modes.map(m =>
				createFlagsQuickPickItem<Flags>(
					state.flags,
					updateRefs ? [...m.flags, '--update-refs'] : [...m.flags],
					{
						label: m.label,
						description: m.description,
						detail: updateRefs ? `${m.detail}${updateRefsClause}` : m.detail,
						picked: m.picked,
					},
				),
			);

		let items = buildItems();

		// A row rather than a title-bar button: quickpick buttons are icon-only (`iconPath` is the only
		// visual the API exposes, with the rest on a hover tooltip), and a modifier that rewrites what every
		// option does should say so in words. `Directive.Noop` keeps the quickpick open on select, and the
		// row object is reused with a mutated icon so the active row survives the refresh by identity.
		const toggleIcon = () => new ThemeIcon(`gitlens-checkbox-${updateRefs ? 'checked' : 'unchecked'}`);
		const updateRefsToggle = createDirectiveQuickPickItem(Directive.Noop, false, {
			label: 'Update Branches',
			detail: 'Also move any branches pointing to the rebased commits',
			iconPath: toggleIcon(),
		});

		let potentialConflict: Promise<ConflictDetectionResult | undefined> | undefined;
		if (isTrialOrPaid) {
			potentialConflict = state.repo.git.commits
				.getLogShas(`${state.destination.ref}..${context.branch.name}`, { merges: false, reverse: true })
				.then(shas =>
					state.repo.git.branches.getPotentialApplyConflicts?.(state.destination.ref, [...shas], {
						stopOnFirstConflict: true,
					}),
				);
		}

		let step: QuickPickStep<DirectiveQuickPickItem | FlagsQuickPickItem<Flags>>;

		const notices: DirectiveQuickPickItem[] = [];

		/** Every row the confirm step shows, minus the separator + Cancel that `createConfirmStep` appends.
		 *  The separator is labelled so the toggle reads as a modifier on the modes above it rather than a
		 *  fourth mode — the divider alone doesn't carry that. */
		const buildRows = (): (DirectiveQuickPickItem | FlagsQuickPickItem<Flags>)[] => [
			...notices,
			...items,
			createQuickPickSeparator('Options'),
			updateRefsToggle,
		];

		/**
		 * Rewrites the live quickpick's rows. Confirm steps can't refresh via `retry()` — that feeds
		 * `Directive.Noop` back into the generator, which fails `canPickStepContinue` and pops the wizard
		 * back to branch selection — so the async conflict notices and the Update Branches toggle both
		 * mutate the quickpick in place instead. The notices and the toggle row keep their identity across a
		 * rebuild, so whichever of them is active survives; only the mode rows are replaced.
		 */
		const refreshQuickPick = () => {
			if (step?.quickpick == null) return;

			const active = step.quickpick.activeItems;
			step.quickpick.items = [
				...buildRows(),
				createQuickPickSeparator(),
				createDirectiveQuickPickItem(Directive.Cancel),
			];
			step.quickpick.activeItems = active;
		};

		// Flips the modifier and rewrites the rows in place — the mode items carry `--update-refs` in their
		// flags (the accepted item's flags are the whole contract with `execute()`), so they're rebuilt too.
		updateRefsToggle.onDidSelect = () => {
			updateRefs = !updateRefs;
			updateRefsToggle.iconPath = toggleIcon();
			items = buildItems();
			refreshQuickPick();
		};

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
							detail: `Will result in ${result.stoppedOnFirstConflict ? 'at least ' : ''}${pluralize(
								'conflicting file',
								result.conflict.files.length,
							)} that will need to be resolved`,
							iconPath: new ThemeIcon('warning'),
						}),
					);
				}

				refreshQuickPick();
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
