import { window } from 'vscode';
import type { Container } from '../../../container.js';
import { BranchError } from '../../../git/errors.js';
import type { GitBranchReference } from '../../../git/models/reference.js';
import type { Repository } from '../../../git/models/repository.js';
import type { GitWorktree } from '../../../git/models/worktree.js';
import { getWorktreesByBranch } from '../../../git/utils/-webview/worktree.utils.js';
import { getBranchNameAndRemote } from '../../../git/utils/branch.utils.js';
import { getReferenceLabel } from '../../../git/utils/reference.utils.js';
import { showGitErrorMessage } from '../../../messages.js';
import { createQuickPickSeparator } from '../../../quickpicks/items/common.js';
import type { FlagsQuickPickItem } from '../../../quickpicks/items/flags.js';
import { createFlagsQuickPickItem } from '../../../quickpicks/items/flags.js';
import { ensureArray } from '../../../system/array.js';
import { Logger } from '../../../system/logger.js';
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
import { pickRepositoryStep } from '../../quick-wizard/steps/repositories.js';
import { StepsController } from '../../quick-wizard/stepsController.js';
import { getSteps } from '../../quick-wizard/utils/quickWizard.utils.js';
import {
	appendReposToTitle,
	assertStepState,
	canPickStepContinue,
	createConfirmStep,
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
interface State<Repo = string | Repository, Refs = GitBranchReference | GitBranchReference[]> {
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
			prune ? 'Prune Branches' : 'Delete Branches',
			{
				description: prune ? 'deletes local branches with missing upstreams' : 'deletes the specified branches',
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
				// Only show the picker if there are multiple repositories
				if (context.repos.length === 1) {
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

			assertStepState<State<Repository>>(state);
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
						? 'Choose branches with missing upstreams to delete'
						: 'Choose branches to delete',
					emptyPlaceholder: prune ? `No branches with missing upstreams in ${state.repo.name}` : undefined,
					sort: { current: false, missingUpstream: true },
				});
				if (result === StepResultBreak) {
					state.references = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				state.references = result;
			}

			assertStepState<State<Repository, GitBranchReference[]>>(state);

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
								title: `Delete ${worktrees.length === 1 ? 'Worktree' : 'Worktrees'} for ${
									worktrees.length === 1 ? 'Branch' : 'Branches'
								}`,
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
						const confirm = { title: 'Delete Branch' };
						const cancel = { title: 'Cancel', isCloseAffordance: true };
						const result = await window.showWarningMessage(
							`Unable to delete branch '${name}' as it is not fully merged. Do you want to delete it anyway?`,
							{ modal: true },
							confirm,
							cancel,
						);

						if (result === confirm) {
							try {
								await state.repo.git.branches.deleteLocalBranch?.(name, { force: true });
							} catch (ex) {
								Logger.error(ex, context.title);
								void showGitErrorMessage(
									ex,
									BranchError.is(ex) ? undefined : 'Unable to force delete branch',
								);
							}
						}

						continue;
					}

					Logger.error(ex, context.title);
					void showGitErrorMessage(ex, BranchError.is(ex) ? undefined : 'Unable to delete branch');
				}
			}
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	private getSelectedWorktrees(
		state: StepState<State<Repository, GitBranchReference[]>>,
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
		state: StepState<State<Repository, GitBranchReference[]>>,
		context: BranchContext,
	): StepResultGenerator<Flags[]> {
		const confirmations: FlagsQuickPickItem<Flags>[] = [
			createFlagsQuickPickItem<Flags>(state.flags, [], {
				label: context.title,
				detail: `Will delete ${getReferenceLabel(state.references)}`,
			}),
		];
		if (!state.references.every(b => b.remote)) {
			confirmations.push(
				createFlagsQuickPickItem<Flags>(state.flags, ['--force'], {
					label: `Force ${context.title}`,
					description: '--force',
					detail: `Will forcibly delete ${getReferenceLabel(state.references)}`,
				}),
			);

			if (!this.prune && state.references.some(b => b.upstream != null)) {
				confirmations.push(
					createQuickPickSeparator(),
					createFlagsQuickPickItem<Flags>(state.flags, ['--remotes'], {
						label: 'Delete Local & Remote Branches',
						description: '--remotes',
						detail: `Will delete ${getReferenceLabel(state.references)} and any upstream tracking branches`,
					}),
					createFlagsQuickPickItem<Flags>(state.flags, ['--force', '--remotes'], {
						label: 'Force Delete Local & Remote Branches',
						description: '--force --remotes',
						detail: `Will forcibly delete ${getReferenceLabel(
							state.references,
						)} and any upstream tracking branches`,
					}),
				);
			}
		}

		const step: QuickPickStep<FlagsQuickPickItem<Flags>> = createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			confirmations,
			context,
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}
}
