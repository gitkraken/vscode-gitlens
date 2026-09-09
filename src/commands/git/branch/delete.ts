import { l10n, window } from 'vscode';
import { BranchError } from '@gitlens/git/errors.js';
import type { GitBranchReference } from '@gitlens/git/models/reference.js';
import type { GitWorktree } from '@gitlens/git/models/worktree.js';
import { getBranchNameAndRemote } from '@gitlens/git/utils/branch.utils.js';
import { getReferenceLabel } from '@gitlens/git/utils/reference.utils.js';
import { ensureArray } from '@gitlens/utils/array.js';
import { Logger } from '@gitlens/utils/logger.js';
import { formatPlural } from '@gitlens/utils/plural.js';
import type { Container } from '../../../container.js';
import type { GlRepository } from '../../../git/models/repository.js';
import { getWorktreesByBranch } from '../../../git/utils/-webview/worktree.utils.js';
import { showGitErrorMessage } from '../../../messages.js';
import { createQuickPickSeparator } from '../../../quickpicks/items/common.js';
import type { ConfirmToggleQuickPickItem, DirectiveQuickPickItem } from '../../../quickpicks/items/directive.js';
import { createConfirmToggleQuickPickItem } from '../../../quickpicks/items/directive.js';
import type { FlagsQuickPickItem } from '../../../quickpicks/items/flags.js';
import { createFlagsQuickPickItem } from '../../../quickpicks/items/flags.js';
import type {
	PartialStepState,
	StepGenerator,
	StepResultGenerator,
	StepsContext,
	StepSelection,
	StepState,
} from '../../quick-wizard/models/steps.js';
import { StepResultBreak } from '../../quick-wizard/models/steps.js';
import type { QuickPickStep } from '../../quick-wizard/models/steps.quickpick.js';
import { QuickCommand } from '../../quick-wizard/quickCommand.js';
import { pickBranchesStep } from '../../quick-wizard/steps/branches.js';
import { canSkipRepositoryPick, pickRepositoryStep } from '../../quick-wizard/steps/repositories.js';
import { StepsController } from '../../quick-wizard/stepsController.js';
import { getSteps } from '../../quick-wizard/utils/quickWizard.utils.js';
import {
	appendReposToTitle,
	assertStepState,
	canPickStepContinue,
	confirmOptionsSeparatorLabel,
	createConfirmStep,
	refreshConfirmStepItems,
} from '../../quick-wizard/utils/steps.utils.js';
import type { BranchContext } from '../branch.js';

const Steps = {
	PickRepo: 'branch-delete-pick-repo',
	PickBranches: 'branch-delete-pick-branches',
	DeleteWorktrees: 'branch-delete-delete-worktrees',
	Confirm: 'branch-delete-confirm',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];
export type BranchDeleteStepNames = StepNames;

type Context = BranchContext<StepNames>;

type Flags = '--force' | '--remotes';
interface State<Repo = string | GlRepository, Refs = GitBranchReference | GitBranchReference[]> {
	repo: Repo;
	references: Refs;
	flags: Flags[];
}
export type BranchDeleteState = State;

export interface BranchDeleteGitCommandArgs {
	readonly command: 'branch-delete';
	confirm?: boolean;
	state?: Partial<State>;
}

export interface BranchPruneGitCommandArgs {
	readonly command: 'branch-prune';
	confirm?: boolean;
	state?: Partial<State>;
}

export class BranchDeleteGitCommand extends QuickCommand<State> {
	private readonly prune: boolean;

	constructor(container: Container, args?: BranchDeleteGitCommandArgs | BranchPruneGitCommandArgs) {
		const prune = args?.command === 'branch-prune';
		super(
			container,
			prune ? 'branch-prune' : 'branch-delete',
			prune ? 'prune' : 'delete',
			prune ? l10n.t('Prune Branches') : l10n.t('Delete Branches'),
			{
				description: prune
					? l10n.t('deletes local branches with missing upstreams')
					: l10n.t('deletes the specified branches'),
			},
		);

		this.prune = prune;
		this.initialState = { confirm: args?.confirm, ...args?.state };
	}

	override get canSkipConfirm(): boolean {
		return false; // Always confirm delete/prune operations
	}

	protected createContext(context?: StepsContext<any>): Context {
		return {
			...context,
			container: this.container,
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.branches,
			showTags: false,
			title: this.title,
		};
	}

	protected async *steps(state: PartialStepState<State>, context?: Context): StepGenerator {
		context ??= this.createContext();
		using steps = new StepsController<StepNames>(context, this);

		state.flags ??= [];
		const { prune } = this;

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
			state.references = ensureArray(state.references);

			const worktreesByBranch = await getWorktreesByBranch(state.repo, { includeDefault: true });

			if (steps.isAtStep(Steps.PickBranches) || !state.references?.length) {
				using step = steps.enterStep(Steps.PickBranches);

				context.title = this.title;

				const result = yield* pickBranchesStep(state, context, {
					filter: prune
						? b => !b.current && Boolean(b.upstream?.missing) && !worktreesByBranch.get(b.id)?.isDefault
						: b => !b.current && !worktreesByBranch.get(b.id)?.isDefault,
					picked: state.references?.map(r => r.ref),
					placeholder: prune
						? l10n.t('Choose branches with missing upstreams to delete')
						: l10n.t('Choose branches to delete'),
					emptyPlaceholder: prune
						? l10n.t('No branches with missing upstreams in {0}', state.repo.name)
						: undefined,
					sort: { current: false, missingUpstream: true },
				});
				if (result === StepResultBreak) {
					state.references = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				state.references = result;
			}

			assertStepState<State<GlRepository, GitBranchReference[]>>(state);

			const worktrees = this.getSelectedWorktrees(state, worktreesByBranch);
			if (worktrees.length) {
				using step = steps.enterStep(Steps.DeleteWorktrees);

				const result = yield* getSteps(
					this.container,
					{
						command: 'worktree',
						state: {
							subcommand: 'delete',
							repo: state.repo,
							uris: worktrees.map(wt => wt.uri),
							startingFromBranchDelete: true,
							overrides: {
								title: formatPlural(
									l10n.t(
										'{0, plural, one{Delete Worktree for Branch} other{Delete Worktrees for Branches}}',
									),
									[worktrees.length],
								),
							},
						},
					},
					context,
					this.startedFrom,
				);
				if (result === StepResultBreak) {
					if (step.goBack() == null) break;
					continue;
				}
			}

			if (!steps.isAtStepOrUnset(Steps.Confirm)) continue;

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

			for (const ref of state.references) {
				const [name, remote] = getBranchNameAndRemote(ref);
				try {
					if (ref.remote) {
						await state.repo.git.branches.deleteRemoteBranch?.(name, remote!);
					} else {
						await state.repo.git.branches.deleteLocalBranch?.(name, {
							force: state.flags.includes('--force'),
						});
						if (state.flags.includes('--remotes') && remote) {
							await state.repo.git.branches.deleteRemoteBranch?.(name, remote);
						}
					}
				} catch (ex) {
					if (BranchError.is(ex, 'notFullyMerged')) {
						const confirm = { title: l10n.t('Delete Branch') };
						const cancel = { title: l10n.t('Cancel'), isCloseAffordance: true };
						const result = await window.showWarningMessage(
							l10n.t(
								"Unable to delete branch '{0}' as it is not fully merged. Do you want to delete it anyway?",
								name,
							),
							{ modal: true },
							confirm,
							cancel,
						);

						if (result === confirm) {
							try {
								await state.repo.git.branches.deleteLocalBranch?.(name, { force: true });
							} catch (ex) {
								Logger.error(ex, this.prune ? 'Prune Branches' : 'Delete Branches');
								void showGitErrorMessage(
									ex,
									BranchError.is(ex) ? undefined : l10n.t('Unable to force delete branch'),
								);
							}
						}

						continue;
					}

					Logger.error(ex, this.prune ? 'Prune Branches' : 'Delete Branches');
					void showGitErrorMessage(ex, BranchError.is(ex) ? undefined : l10n.t('Unable to delete branch'));
				}
			}
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	private getSelectedWorktrees(
		state: StepState<State<GlRepository, GitBranchReference[]>>,
		worktreesByBranch: Map<string, GitWorktree>,
	): GitWorktree[] {
		const worktrees: GitWorktree[] = [];

		for (const ref of ensureArray(state.references)) {
			const worktree = worktreesByBranch.get(ref.id!);
			if (worktree != null && !worktree.isDefault) {
				worktrees.push(worktree);
			}
		}

		return worktrees;
	}

	private *confirmStep(
		state: StepState<State<GlRepository, GitBranchReference[]>>,
		context: BranchContext,
	): StepResultGenerator<Flags[]> {
		const { prune } = this;
		const refsLabel = getReferenceLabel(state.references);

		// Remote-tracking refs (e.g. `origin/foo`) don't take `--force` or have an upstream of their own,
		// so neither the Force toggle nor the "& Upstream(s)" mode applies when every selected ref is remote.
		const canForce = !state.references.every(b => b.remote);
		const canDeleteUpstreams = canForce && !prune && state.references.some(b => b.upstream != null);

		let force = state.flags.includes('--force');

		// Folds the live Force toggle value into each mode's flags and detail — the accepted item's flags
		// are the whole contract with `execute()` — so the list says what will actually happen.
		const buildItems = (): FlagsQuickPickItem<Flags>[] => {
			const label = prune
				? force
					? formatPlural(l10n.t('{0, plural, one{Force Prune Branch} other{Force Prune Branches}}'), [
							state.references.length,
						])
					: formatPlural(l10n.t('{0, plural, one{Prune Branch} other{Prune Branches}}'), [
							state.references.length,
						])
				: force
					? formatPlural(l10n.t('{0, plural, one{Force Delete Branch} other{Force Delete Branches}}'), [
							state.references.length,
						])
					: formatPlural(l10n.t('{0, plural, one{Delete Branch} other{Delete Branches}}'), [
							state.references.length,
						]);
			const items: FlagsQuickPickItem<Flags>[] = [
				createFlagsQuickPickItem<Flags>(state.flags, force ? ['--force'] : [], {
					label: label,
					description: force ? '--force' : undefined,
					detail: force
						? l10n.t('Will forcibly delete {0}, even if not fully merged', refsLabel)
						: l10n.t('Will delete {0}', refsLabel),
					picked: !state.flags.includes('--remotes'),
				}),
			];

			if (canDeleteUpstreams) {
				items.push(
					createFlagsQuickPickItem<Flags>(state.flags, force ? ['--force', '--remotes'] : ['--remotes'], {
						label: force
							? formatPlural(
									l10n.t(
										'{0, plural, one{Force Delete Branch & Upstream} other{Force Delete Branches & Upstreams}}',
									),
									[state.references.length],
								)
							: formatPlural(
									l10n.t(
										'{0, plural, one{Delete Branch & Upstream} other{Delete Branches & Upstreams}}',
									),
									[state.references.length],
								),
						description: force ? '--force --remotes' : '--remotes',
						detail: force
							? formatPlural(
									l10n.t(
										'{0, plural, one{Will forcibly delete {1} and its upstream branch from the remote, even if not fully merged} other{Will forcibly delete {1} and its upstream branches from the remote, even if not fully merged}}',
									),
									[state.references.length, refsLabel],
								)
							: formatPlural(
									l10n.t(
										'{0, plural, one{Will delete {1} and its upstream branch from the remote} other{Will delete {1} and its upstream branches from the remote}}',
									),
									[state.references.length, refsLabel],
								),
						picked: state.flags.includes('--remotes'),
					}),
				);
			}

			return items;
		};

		let items = buildItems();

		// Takes the toggle row rather than closing over it so this can be declared before the toggle
		// itself, which needs `buildRows` in its handler.
		const buildRows = (
			toggle?: ConfirmToggleQuickPickItem,
		): (FlagsQuickPickItem<Flags> | DirectiveQuickPickItem)[] =>
			toggle != null ? [...items, createQuickPickSeparator(confirmOptionsSeparatorLabel), toggle] : items;

		let step: QuickPickStep<FlagsQuickPickItem<Flags> | DirectiveQuickPickItem>;

		let rows: (FlagsQuickPickItem<Flags> | DirectiveQuickPickItem)[];
		if (canForce) {
			const forceToggle = createConfirmToggleQuickPickItem({
				label: force ? l10n.t('$(warning) Force') : l10n.t('Force'),
				description: '--force',
				detail: force
					? l10n.t('Delete even if not fully merged — unmerged commits may be lost')
					: l10n.t('Delete even if not fully merged'),
				checked: force,
				onDidChange: item => {
					force = item.checked;
					item.label = force ? l10n.t('$(warning) Force') : l10n.t('Force');
					item.detail = force
						? l10n.t('Delete even if not fully merged — unmerged commits may be lost')
						: l10n.t('Delete even if not fully merged');
					items = buildItems();
					refreshConfirmStepItems(step, buildRows(item));
				},
			});
			rows = buildRows(forceToggle);
		} else {
			rows = buildRows();
		}

		const confirmTitle = prune ? l10n.t('Confirm Prune Branches') : l10n.t('Confirm Delete Branches');
		step = createConfirmStep(appendReposToTitle(confirmTitle, state, context), rows, confirmTitle);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}
}
