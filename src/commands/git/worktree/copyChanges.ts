import { l10n, window } from 'vscode';
import { ApplyPatchCommitError } from '@gitlens/git/errors.js';
import type { GitDiff } from '@gitlens/git/models/diff.js';
import { uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
import type { GitWorktree } from '@gitlens/git/models/worktree.js';
import { isSha } from '@gitlens/git/utils/revision.utils.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { getNumericFormat } from '@gitlens/utils/date.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { Container } from '../../../container.js';
import { getPresentableErrorMessage } from '../../../errors.js';
import type { GlRepository } from '../../../git/models/repository.js';
import type { DirectiveQuickPickItem } from '../../../quickpicks/items/directive.js';
import { createDirectiveQuickPickItem, Directive } from '../../../quickpicks/items/directive.js';
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
import { canSkipRepositoryPick, pickRepositoryStep } from '../../quick-wizard/steps/repositories.js';
import { pickWorktreeStep } from '../../quick-wizard/steps/worktrees.js';
import { StepsController } from '../../quick-wizard/stepsController.js';
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

interface State<Repo = string | GlRepository> {
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

function getConfirmTitle(changesType: State['changes']['type']): string {
	return changesType === 'index'
		? l10n.t('Confirm Copy Staged Changes to Worktree')
		: l10n.t('Confirm Copy Working Changes to Worktree');
}

function getConfirmTitleWithTarget(changesType: State['changes']['type'], targetName: string): string {
	return changesType === 'index'
		? l10n.t('Confirm Copy Staged Changes to Worktree • {0}', targetName)
		: l10n.t('Confirm Copy Working Changes to Worktree • {0}', targetName);
}

export class WorktreeCopyChangesGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: WorktreeCopyChangesGitCommandArgs) {
		super(container, 'worktree-copy-changes', 'copy-changes', l10n.t('Copy Changes to Worktree'), {
			description: l10n.t('copies changes to another worktree'),
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
				// Skip the picker only when the sole available repo is the one requested
				if (canSkipRepositoryPick(context.repos, state.repo)) {
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

			assertStepState<State<GlRepository>>(state);

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
						context.title = state.overrides?.title ?? l10n.t('Copy Staged Changes to Worktree');
						placeholder = l10n.t('Choose a worktree to copy your staged changes to');
						break;
					case 'working-tree':
					default:
						context.title = state.overrides?.title ?? l10n.t('Copy Working Changes to Worktree');
						placeholder = l10n.t('Choose a worktree to copy your working changes to');
						break;
				}

				// Exclude the source worktree as a target -- copying changes into the worktree they came
				// from is a no-op. The source is `state.source` when provided (e.g. from the Worktrees view),
				// otherwise the repo we're operating on (e.g. the WIP row's worktree in the graph) -- which
				// matches the source the changes are read from below.
				const sourcePath = (state.source ?? state.repo).path;
				const result = yield* pickWorktreeStep(state, context, {
					filter: wt => wt.path !== sourcePath,
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

					const staged = state.changes.type === 'index';
					const noChangesStep: QuickPickStep<DirectiveQuickPickItem> = this.createConfirmStep(
						getConfirmTitle(state.changes.type),
						[],
						staged
							? l10n.t('Nothing to copy; no staged changes found')
							: l10n.t('Nothing to copy; no working changes found'),
						createDirectiveQuickPickItem(Directive.Cancel, true, {
							label: l10n.t('OK'),
							detail: staged
								? l10n.t('There are no staged changes to copy')
								: l10n.t('There are no working changes to copy'),
						}),
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
				void window.showInformationMessage(l10n.t('Changes copied successfully'));
			} catch (ex) {
				if (isCancellationError(ex)) return;

				if (ApplyPatchCommitError.is(ex, 'appliedWithConflicts')) {
					void window.showWarningMessage(l10n.t('Changes copied with conflicts'));
				} else {
					if (ApplyPatchCommitError.is(ex, 'wouldOverwriteChanges')) {
						void window.showErrorMessage(
							l10n.t('Unable to copy changes as some local changes would be overwritten'),
						);
						return;
					}

					void window.showErrorMessage(l10n.t('Unable to copy changes: {0}', getPresentableErrorMessage(ex)));
					return;
				}
			}

			break;
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	private async *confirmStep(
		state: StepState<State<GlRepository>>,
		_context: Context,
	): AsyncStepResultGenerator<void> {
		const files = await state.repo.git.diff.getDiffFiles?.(state.changes.contents!);
		const count = files?.files.length ?? 0;
		const formattedCount = getNumericFormat()(count);

		const confirmations = [];
		const getDetail = () => {
			const staged = state.changes.type === 'index';
			if (state.source != null) {
				if (count === 1) {
					return staged
						? l10n.t(
								"Will copy the staged changes ({0} file) from worktree '{1}' to worktree '{2}'",
								formattedCount,
								state.source.name,
								state.target.name,
							)
						: l10n.t(
								"Will copy the working changes ({0} file) from worktree '{1}' to worktree '{2}'",
								formattedCount,
								state.source.name,
								state.target.name,
							);
				}

				if (count > 1) {
					return staged
						? l10n.t(
								"Will copy the staged changes ({0} files) from worktree '{1}' to worktree '{2}'",
								formattedCount,
								state.source.name,
								state.target.name,
							)
						: l10n.t(
								"Will copy the working changes ({0} files) from worktree '{1}' to worktree '{2}'",
								formattedCount,
								state.source.name,
								state.target.name,
							);
				}

				return staged
					? l10n.t(
							"Will copy the staged changes from worktree '{0}' to worktree '{1}'",
							state.source.name,
							state.target.name,
						)
					: l10n.t(
							"Will copy the working changes from worktree '{0}' to worktree '{1}'",
							state.source.name,
							state.target.name,
						);
			}

			if (count === 1) {
				return staged
					? l10n.t(
							"Will copy the staged changes ({0} file) to worktree '{1}'",
							formattedCount,
							state.target.name,
						)
					: l10n.t(
							"Will copy the working changes ({0} file) to worktree '{1}'",
							formattedCount,
							state.target.name,
						);
			}

			if (count > 1) {
				return staged
					? l10n.t(
							"Will copy the staged changes ({0} files) to worktree '{1}'",
							formattedCount,
							state.target.name,
						)
					: l10n.t(
							"Will copy the working changes ({0} files) to worktree '{1}'",
							formattedCount,
							state.target.name,
						);
			}

			return staged
				? l10n.t("Will copy the staged changes to worktree '{0}'", state.target.name)
				: l10n.t("Will copy the working changes to worktree '{0}'", state.target.name);
		};
		switch (state.changes.type) {
			case 'index':
				confirmations.push({
					label: l10n.t('Copy Staged Changes to Worktree'),
					detail: getDetail(),
				});
				break;
			case 'working-tree':
			default:
				confirmations.push({
					label: l10n.t('Copy Working Changes to Worktree'),
					detail: getDetail(),
				});
				break;
		}

		const step = createConfirmStep(
			getConfirmTitleWithTarget(state.changes.type, state.target.name),
			confirmations,
			getConfirmTitle(state.changes.type),
		);

		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? undefined : StepResultBreak;
	}
}
