import type { MessageItem, Uri } from 'vscode';
import { window } from 'vscode';
import type { Container } from '../../../container.js';
import { executeGitCommand } from '../../../git/actions.js';
import { WorktreeDeleteError } from '../../../git/errors.js';
import type { GitBranchReference } from '../../../git/models/reference.js';
import type { Repository } from '../../../git/models/repository.js';
import { getReferenceFromBranch } from '../../../git/utils/-webview/reference.utils.js';
import { showGitErrorMessage } from '../../../messages.js';
import { createQuickPickSeparator } from '../../../quickpicks/items/common.js';
import type { FlagsQuickPickItem } from '../../../quickpicks/items/flags.js';
import { createFlagsQuickPickItem } from '../../../quickpicks/items/flags.js';
import { getWorkspaceFriendlyPath } from '../../../system/-webview/vscode/workspaces.js';
import { revealInFileExplorer } from '../../../system/-webview/vscode.js';
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
import { ensureAccessStep } from '../../quick-wizard/steps/access.js';
import { pickRepositoryStep } from '../../quick-wizard/steps/repositories.js';
import { pickWorktreesStep } from '../../quick-wizard/steps/worktrees.js';
import { StepsController } from '../../quick-wizard/stepsController.js';
import {
	appendReposToTitle,
	assertStepState,
	canPickStepContinue,
	createConfirmStep,
} from '../../quick-wizard/utils/steps.utils.js';
import type { WorktreeContext } from '../worktree.js';

const Steps = {
	PickRepo: 'worktree-delete-pick-repo',
	EnsureAccess: 'worktree-delete-ensure-access',
	PickWorktrees: 'worktree-delete-pick-worktrees',
	Confirm: 'worktree-delete-confirm',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];
export type WorktreeDeleteStepNames = StepNames;

type Context = WorktreeContext<StepNames>;

type Flags = '--force' | '--delete-branches';
interface State<Repo = string | Repository> {
	repo: Repo;
	uris: Uri[];
	flags: Flags[];

	startingFromBranchDelete?: boolean;
	overrides?: {
		title?: string;
	};
}
export type WorktreeDeleteState = State;

export interface WorktreeDeleteGitCommandArgs {
	readonly command: 'worktree-delete';
	confirm?: boolean;
	state?: Partial<State>;
}

export class WorktreeDeleteGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: WorktreeDeleteGitCommandArgs) {
		super(container, 'worktree-delete', 'delete', 'Delete Worktrees', {
			description: 'deletes the specified worktrees',
		});

		this.initialState = { confirm: args?.confirm, flags: [], ...args?.state };
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

		state.flags ??= [];

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

			context.worktrees = (await state.repo.git.worktrees?.getWorktrees()) ?? [];

			if (steps.isAtStep(Steps.PickWorktrees) || !state.uris?.length) {
				using step = steps.enterStep(Steps.PickWorktrees);

				context.title = this.title;

				const result = yield* pickWorktreesStep(state, context, {
					// Can't delete the main or opened worktree
					excludeOpened: true,
					filter: wt => !wt.isDefault,
					includeStatus: true,
					picked: state.uris?.map(uri => uri.toString()),
					placeholder: 'Choose worktrees to delete',
				});
				if (result === StepResultBreak) {
					state.uris = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				state.uris = result.map(w => w.uri);
			}

			context.title = this.title;

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

			const branchesToDelete: GitBranchReference[] = [];

			for (const uri of state.uris) {
				let skipHasChangesPrompt = false;
				let succeeded = false;

				const deleteBranches = state.flags.includes('--delete-branches');
				let force = state.flags.includes('--force');
				const worktree = context.worktrees?.find(wt => wt.uri.toString() === uri.toString());

				while (true) {
					succeeded = false;

					try {
						if (force) {
							let hasChanges;
							try {
								hasChanges = await worktree?.hasWorkingChanges();
							} catch {}

							if ((hasChanges ?? false) && !skipHasChangesPrompt) {
								const confirm: MessageItem = { title: 'Force Delete' };
								const cancel: MessageItem = { title: 'Cancel', isCloseAffordance: true };
								const result = await window.showWarningMessage(
									`The worktree in '${uri.fsPath}' has uncommitted changes.\n\nDeleting it will cause those changes to be FOREVER LOST.\nThis is IRREVERSIBLE!\n\nAre you sure you still want to delete it?`,
									{ modal: true },
									confirm,
									cancel,
								);

								if (result !== confirm) return;
							}
						}

						await state.repo.git.worktrees?.deleteWorktree(uri, { force: force });
						succeeded = true;
					} catch (ex) {
						skipHasChangesPrompt = false;

						if (WorktreeDeleteError.is(ex)) {
							if (ex.details.reason === 'defaultWorkingTree') {
								void window.showErrorMessage('Cannot delete the default worktree.');
								break;
							}

							if (ex.details.reason === 'directoryNotEmpty') {
								const openFolder: MessageItem = { title: 'Open Folder' };
								const confirm: MessageItem = { title: 'OK', isCloseAffordance: true };
								const result = await window.showErrorMessage(
									`Unable to fully clean up the delete worktree in '${uri.fsPath}' because the folder is not empty.`,
									{ modal: true },
									openFolder,
									confirm,
								);

								if (result === openFolder) {
									void revealInFileExplorer(uri);
								}

								succeeded = true;
								break;
							}

							if (!force) {
								const confirm: MessageItem = { title: 'Force Delete' };
								const cancel: MessageItem = { title: 'Cancel', isCloseAffordance: true };
								const result = await window.showErrorMessage(
									ex.details.reason === 'uncommittedChanges'
										? `Unable to delete worktree because there are UNCOMMITTED changes in '${uri.fsPath}'.\n\nForcibly deleting it will cause those changes to be FOREVER LOST.\nThis is IRREVERSIBLE!\n\nWould you like to forcibly delete it?`
										: `Unable to delete worktree in '${uri.fsPath}'.\n\nWould you like to try to forcibly delete it?`,
									{ modal: true },
									confirm,
									cancel,
								);

								if (result === confirm) {
									force = true;
									skipHasChangesPrompt = ex.details.reason === 'uncommittedChanges';
									continue;
								}

								break;
							}
						}

						void showGitErrorMessage(ex, `Unable to delete worktree in '${uri.fsPath}. ex=${String(ex)}`);
					}

					break;
				}

				if (succeeded && deleteBranches && worktree?.branch) {
					branchesToDelete.push(getReferenceFromBranch(worktree?.branch));
				}
			}

			steps.markStepsComplete();

			if (branchesToDelete.length) {
				// Don't use `getSteps` here because this is a whole new flow, a
				// and because of the modals above it won't even work (since the modals will trigger the quick pick to hide)
				void executeGitCommand({
					command: 'branch',
					state: { subcommand: 'delete', repo: state.repo, references: branchesToDelete },
				});
			}
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	private *confirmStep(state: StepState<State<Repository>>, context: Context): StepResultGenerator<Flags[]> {
		context.title = state.uris.length === 1 ? 'Delete Worktree' : 'Delete Worktrees';

		const label = state.uris.length === 1 ? 'Delete Worktree' : 'Delete Worktrees';
		const branchesLabel = state.uris.length === 1 ? 'Branch' : 'Branches';
		let selectedBranchesLabelSuffix = '';
		if (state.startingFromBranchDelete) {
			selectedBranchesLabelSuffix = ` for ${branchesLabel}`;
			context.title = `${context.title}${selectedBranchesLabelSuffix}`;
		}

		const description =
			state.uris.length === 1
				? `delete worktree in $(folder) ${getWorkspaceFriendlyPath(state.uris[0])}`
				: `delete ${state.uris.length} worktrees`;
		const descriptionWithBranchDelete =
			state.uris.length === 1
				? 'delete the worktree and then prompt to delete the associated branch'
				: `delete ${state.uris.length} worktrees and then prompt to delete the associated branches`;

		const step: QuickPickStep<FlagsQuickPickItem<Flags>> = createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			[
				createFlagsQuickPickItem<Flags>(state.flags, [], {
					label: `${label}${selectedBranchesLabelSuffix}`,
					detail: `Will ${description}`,
				}),
				createFlagsQuickPickItem<Flags>(state.flags, ['--force'], {
					label: `Force ${label}${selectedBranchesLabelSuffix}`,
					description: 'includes ANY UNCOMMITTED changes',
					detail: `Will forcibly ${description}`,
				}),
				...(state.startingFromBranchDelete
					? []
					: [
							createQuickPickSeparator<FlagsQuickPickItem<Flags>>(),
							createFlagsQuickPickItem<Flags>(state.flags, ['--delete-branches'], {
								label: `${label} & ${branchesLabel}`,
								detail: `Will ${descriptionWithBranchDelete}`,
							}),
							createFlagsQuickPickItem<Flags>(state.flags, ['--force', '--delete-branches'], {
								label: `Force ${label} & ${branchesLabel}`,
								description: 'includes ANY UNCOMMITTED changes',
								detail: `Will forcibly ${descriptionWithBranchDelete}`,
							}),
						]),
			],
			context,
		);

		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}
}
