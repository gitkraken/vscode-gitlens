import { window } from 'vscode';
import type { Container } from '../../../container.js';
import { CancellationError } from '../../../errors.js';
import { ApplyPatchCommitError } from '../../../git/errors.js';
import type { GitDiff } from '../../../git/models/diff.js';
import type { Repository } from '../../../git/models/repository.js';
import { uncommitted, uncommittedStaged } from '../../../git/models/revision.js';
import type { GitWorktree } from '../../../git/models/worktree.js';
import { isSha } from '../../../git/utils/revision.utils.js';
import type { DirectiveQuickPickItem } from '../../../quickpicks/items/directive.js';
import { createDirectiveQuickPickItem, Directive } from '../../../quickpicks/items/directive.js';
import { Logger } from '../../../system/logger.js';
import { pluralize } from '../../../system/string.js';
import type {
	AsyncStepResultGenerator,
	PartialStepState,
	StepGenerator,
	StepsContext,
	StepSelection,
	StepState,
} from '../../quick-wizard/models/steps.js';
import { StepResultBreak } from '../../quick-wizard/models/steps.js';
import type { QuickPickStep } from '../../quick-wizard/models/steps.quickpick.js';
import { QuickCommand } from '../../quick-wizard/quickCommand.js';
import { ensureAccessStep } from '../../quick-wizard/steps/access.js';
import { pickRepositoryStep } from '../../quick-wizard/steps/repositories.js';
import { pickWorktreeStep } from '../../quick-wizard/steps/worktrees.js';
import { StepsController } from '../../quick-wizard/stepsController.js';
import { getSteps } from '../../quick-wizard/utils/quickWizard.utils.js';
import { assertStepState, canPickStepContinue, createConfirmStep } from '../../quick-wizard/utils/steps.utils.js';
import type { WorktreeContext } from '../worktree.js';

const Steps = {
	PickRepo: 'worktree-copy-changes-pick-repo',
	EnsureAccess: 'worktree-copy-changes-ensure-access',
	PickWorktree: 'worktree-copy-changes-pick-worktree',
	Confirm: 'worktree-copy-changes-confirm',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];
export type WorktreeCopyChangesStepNames = StepNames;

type Context = WorktreeContext<WorktreeCopyChangesStepNames>;

interface State<Repo = string | Repository> {
	repo: Repo;
	/** Optional source worktree, defaults to the current worktree if not provided */
	source?: GitWorktree;
	target: GitWorktree;
	changes:
		| { baseSha?: string; contents?: string; type: 'index' | 'working-tree' }
		| { baseSha: string; contents: string; type?: 'index' | 'working-tree' };

	overrides?: {
		title?: string;
	};
}
export type WorktreeCopyChangesState = State;

export interface WorktreeCopyChangesGitCommandArgs {
	readonly command: 'worktree-copy-changes';
	confirm?: boolean;
	state?: Partial<State>;
}

export class WorktreeCopyChangesGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: WorktreeCopyChangesGitCommandArgs) {
		super(container, 'worktree-copy-changes', 'copy-changes', 'Copy Changes to Worktree', {
			description: 'copies changes to another worktree',
		});

		this.initialState = {
			confirm: args?.confirm,
			changes: { type: 'working-tree' },
			...args?.state,
		};
	}

	override get canSkipConfirm(): boolean {
		return false;
	}

	protected createContext(context?: StepsContext<any>): Context {
		return {
			...context,
			container: this.container,
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.worktrees,
			showTags: false,
			title: this.title,
		};
	}

	protected async *steps(state: PartialStepState<State>, context?: Context): StepGenerator {
		context ??= this.createContext();
		using steps = new StepsController<StepNames>(context, this);

		while (!steps.isComplete) {
			context.title = state.overrides?.title ?? this.title;

			if (steps.isAtStep(Steps.PickRepo) || state.repo == null || typeof state.repo === 'string') {
				// Only show the picker if there are multiple repositories
				if (context.repos.length === 1) {
					[state.repo] = context.repos;
				} else {
					using step = steps.enterStep(Steps.PickRepo);

					const result = yield* pickRepositoryStep(state, context, step, { excludeWorktrees: true });
					if (result === StepResultBreak) {
						state.repo = undefined!;
						if (step.goBack() == null) break;
						continue;
					}

					state.repo = result;
				}
			}

			assertStepState<State<Repository>>(state);

			if (steps.isAtStepOrUnset(Steps.EnsureAccess)) {
				using step = steps.enterStep(Steps.EnsureAccess);

				const result = yield* ensureAccessStep(this.container, 'worktrees', state, context, step);
				if (result === StepResultBreak) {
					if (step.goBack() == null) break;
					continue;
				}
			}

			context.worktrees ??= (await state.repo.git.worktrees?.getWorktrees()) ?? [];

			if (steps.isAtStep(Steps.PickWorktree) || state.target == null) {
				using step = steps.enterStep(Steps.PickWorktree);

				let placeholder;
				switch (state.changes.type) {
					case 'index':
						context.title =
							state.overrides?.title ??
							`Copy Staged${state.source?.name ? ' Worktree' : ''} Changes to Worktree`;
						placeholder = `Choose a worktree to copy your staged${
							state.source?.name ? ' Worktree' : ''
						} changes to`;
						break;
					case 'working-tree':
					default:
						context.title =
							state.overrides?.title ??
							`Copy Working${state.source?.name ? ' Worktree' : ''} Changes to Worktree`;
						placeholder = `Choose a worktree to copy your working${
							state.source?.name ? ' worktree' : ''
						} changes to`;
						break;
				}

				const result = yield* pickWorktreeStep(state, context, {
					excludeOpened: true,
					includeStatus: true,
					picked: state.target?.uri?.toString(),
					placeholder: placeholder,
				});
				if (result === StepResultBreak) {
					state.target = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				state.target = result;
			}

			const sourceSvc = this.container.git.getRepositoryService(state.source?.uri ?? state.repo.uri);

			if (!state.changes.contents || !state.changes.baseSha) {
				let diff: GitDiff | undefined;
				let untrackedPaths: string[] | undefined;
				try {
					if (state.changes.type !== 'index') {
						// stage any untracked files to include them in the diff
						untrackedPaths = (await sourceSvc.status?.getUntrackedFiles())?.map(f => f.path);
						if (untrackedPaths?.length) {
							try {
								await sourceSvc.staging?.stageFiles(untrackedPaths);
							} catch (ex) {
								Logger.error(
									ex,
									`Failed to stage (${untrackedPaths.length}) untracked files for copying changes`,
								);
							}
						}
					}

					diff = await sourceSvc.diff.getDiff?.(
						state.changes.type === 'index' ? uncommittedStaged : uncommitted,
						'HEAD',
					);
				} finally {
					if (untrackedPaths?.length) {
						try {
							await sourceSvc.staging?.unstageFiles(untrackedPaths);
						} catch (ex) {
							Logger.error(
								ex,
								`Failed to unstage (${untrackedPaths.length}) untracked files for copying changes`,
							);
						}
					}
				}

				if (!diff?.contents) {
					using step = steps.enterStep(Steps.Confirm);

					const changesType = state.changes.type === 'index' ? 'staged' : 'working';
					const noChangesStep: QuickPickStep<DirectiveQuickPickItem> = this.createConfirmStep(
						`Confirm ${context.title}`,
						[],
						createDirectiveQuickPickItem(Directive.Cancel, true, {
							label: 'OK',
							detail: `There are no ${changesType} changes to copy`,
						}),
						{
							placeholder: `Nothing to copy; no ${changesType} changes found`,
						},
					);
					const selection: StepSelection<typeof noChangesStep> = yield noChangesStep;
					canPickStepContinue(noChangesStep, state, selection);

					if (step.goBack() == null) break;
					continue;
				}

				state.changes.contents = diff.contents;
				state.changes.baseSha = diff.from;
			}

			if (!isSha(state.changes.baseSha)) {
				const sha = (await sourceSvc.revision.resolveRevision(state.changes.baseSha)).sha;
				if (sha != null) {
					state.changes.baseSha = sha;
				}
			}

			if (this.confirm(state.confirm)) {
				using step = steps.enterStep(Steps.Confirm);

				const result = yield* this.confirmStep(state, context);
				if (result === StepResultBreak) {
					if (step.goBack() == null) break;
					continue;
				}
			}

			steps.markStepsComplete();

			try {
				const commit = await sourceSvc.patch?.createUnreachableCommitForPatch(
					state.changes.baseSha,
					'Copied Changes',
					state.changes.contents,
				);
				if (commit == null) return;

				const targetSvc = this.container.git.getRepositoryService(state.target.uri);
				await targetSvc.patch?.applyUnreachableCommitForPatch(commit.sha, { stash: false });
				void window.showInformationMessage(`Changes copied successfully`);
			} catch (ex) {
				if (ex instanceof CancellationError) return;

				if (ApplyPatchCommitError.is(ex, 'appliedWithConflicts')) {
					void window.showWarningMessage('Changes copied with conflicts');
				} else {
					if (ApplyPatchCommitError.is(ex, 'wouldOverwriteChanges')) {
						void window.showErrorMessage(
							'Unable to copy changes as some local changes would be overwritten',
						);
						return;
					}

					void window.showErrorMessage(`Unable to copy changes: ${ex.message}`);
					return;
				}
			}

			yield* getSteps(
				this.container,
				{
					command: 'worktree',
					confirm: true,
					state: {
						subcommand: 'open',
						repo: state.repo,
						worktree: state.target,
						flags: [],
						openOnly: true,
						overrides: { canGoBack: false },
					},
				},
				context,
				this.startedFrom,
			);
			break;
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	private async *confirmStep(state: StepState<State<Repository>>, context: Context): AsyncStepResultGenerator<void> {
		const files = await state.repo.git.diff.getDiffFiles?.(state.changes.contents!);
		const count = files?.files.length ?? 0;

		const confirmations = [];
		switch (state.changes.type) {
			case 'index':
				confirmations.push({
					label: 'Copy Staged Changes to Worktree',
					detail: `Will copy the staged changes${count > 0 ? ` (${pluralize('file', count)})` : ''}${
						state.source ? ` from worktree '${state.source.name}'` : ''
					} to worktree '${state.target.name}'`,
				});
				break;
			case 'working-tree':
			default:
				confirmations.push({
					label: 'Copy Working Changes to Worktree',
					detail: `Will copy the working changes${count > 0 ? ` (${pluralize('file', count)})` : ''}${
						state.source ? ` from worktree '${state.source.name}'` : ''
					} to worktree '${state.target.name}'`,
				});
				break;
		}

		const step = createConfirmStep(`Confirm ${context.title} \u2022 ${state.target.name}`, confirmations, context);

		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? undefined : StepResultBreak;
	}
}
