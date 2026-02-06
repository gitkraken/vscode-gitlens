import { window } from 'vscode';
import type { Container } from '../../../container.js';
import { BranchError } from '../../../git/errors.js';
import type { GitBranch } from '../../../git/models/branch.js';
import type { IssueShape } from '../../../git/models/issue.js';
import type { GitReference } from '../../../git/models/reference.js';
import type { Repository } from '../../../git/models/repository.js';
import type { GitWorktree } from '../../../git/models/worktree.js';
import { addAssociatedIssueToBranch } from '../../../git/utils/-webview/branch.issue.utils.js';
import {
	getReferenceLabel,
	getReferenceNameWithoutRemote,
	isBranchReference,
	isRevisionReference,
} from '../../../git/utils/reference.utils.js';
import { showGitErrorMessage } from '../../../messages.js';
import type { ChatActions } from '../../../plus/chat/chatActions.js';
import { getIssueOwner } from '../../../plus/integrations/providers/utils.js';
import type { FlagsQuickPickItem } from '../../../quickpicks/items/flags.js';
import { createFlagsQuickPickItem } from '../../../quickpicks/items/flags.js';
import { Logger } from '../../../system/logger.js';
import type { Deferred } from '../../../system/promise.js';
import { defer } from '../../../system/promise.js';
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
import { inputBranchNameStep } from '../../quick-wizard/steps/branches.js';
import { pickBranchOrTagStep } from '../../quick-wizard/steps/references.js';
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
	PickRepo: 'branch-create-pick-repo',
	PickRef: 'branch-create-pick-ref',
	InputName: 'branch-create-input-name',
	Confirm: 'branch-create-confirm',
	ConfirmCreateWorktree: 'branch-create-confirm-create-worktree',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];
export type BranchCreateStepNames = StepNames;

type Context = BranchContext<StepNames>;

type Flags = '--switch' | '--worktree';
interface State<Repo = string | Repository> {
	repo: Repo;
	suggestedRepo?: Repo;
	reference: GitReference;
	name: string;
	suggestedName?: string;
	flags: Flags[];

	confirmOptions?: Flags[];
	associateWithIssue?: IssueShape;

	// Pass through to worktree command
	worktreeDefaultOpen?: 'new' | 'current';

	// Result tracking
	result?: Deferred<{ branch: GitBranch; worktree?: GitWorktree }>;

	// Chat action for deeplink storage
	chatAction?: ChatActions;
}
export type BranchCreateState = State;

export interface BranchCreateGitCommandArgs {
	readonly command: 'branch-create';
	confirm?: boolean;
	state?: Partial<State>;
}

export class BranchCreateGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: BranchCreateGitCommandArgs) {
		super(container, 'branch-create', 'create', 'Create Branch', {
			description: 'creates a new branch',
		});

		this.initialState = { confirm: args?.confirm, ...args?.state };
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

		try {
			while (!steps.isComplete) {
				context.title = this.title;

				if (steps.isAtStep(Steps.PickRepo) || state.repo == null || typeof state.repo === 'string') {
					// Only show the picker if there are multiple repositories
					if (context.repos.length === 1) {
						[state.repo] = context.repos;
					} else {
						using step = steps.enterStep(Steps.PickRepo);

						const result = yield* pickRepositoryStep(state, context, step, { picked: state.suggestedRepo });
						if (result === StepResultBreak) {
							state.repo = undefined!;
							if (step.goBack() == null) break;
							continue;
						}

						state.repo = result;
					}
				}

				assertStepState<State<Repository>>(state);

				if (steps.isAtStep(Steps.PickRef) || state.reference == null) {
					using step = steps.enterStep(Steps.PickRef);

					const result = yield* pickBranchOrTagStep(state, context, {
						placeholder: `Choose a base to create the new branch from`,
						picked: state.reference?.ref ?? (await state.repo.git.branches.getBranch())?.ref,
						title: 'Select Base to Create Branch From',
						value: isRevisionReference(state.reference) ? state.reference.ref : undefined,
					});
					if (result === StepResultBreak) {
						state.reference = undefined!;
						if (step.goBack() == null) break;
						continue;
					}

					state.reference = result;
				}

				const isRemoteBranch = isBranchReference(state.reference) && state.reference.remote;
				const remoteBranchName = isRemoteBranch ? getReferenceNameWithoutRemote(state.reference) : undefined;

				if (steps.isAtStep(Steps.InputName) || state.name == null) {
					using step = steps.enterStep(Steps.InputName);

					let value: string | undefined = state.name ?? state.suggestedName;
					// if it's a remote branch, pre-fill the name (if it doesn't already exist)
					if (!value && isRemoteBranch && !(await state.repo.git.branches.getBranch(remoteBranchName))) {
						value = remoteBranchName;
					}

					const result = yield* inputBranchNameStep(state, context, {
						prompt: 'Please provide a name for the new branch',
						title: `${context.title} from ${getReferenceLabel(state.reference, {
							capitalize: true,
							icon: false,
							label: state.reference.refType !== 'branch',
						})}`,
						value: value,
					});
					if (result === StepResultBreak) {
						state.name = undefined!;
						if (step.goBack() == null) break;
						continue;
					}

					state.name = result;
				}

				if (!steps.isAtStepOrUnset(Steps.Confirm)) continue;
				if (this.confirm(state.confirm)) {
					using step = steps.enterStep(Steps.Confirm);

					const result = yield* this.confirmStep(state, context);
					if (result === StepResultBreak) {
						state.flags = [];
						if (step.goBack() == null) break;
						continue;
					}

					state.flags = result;
				}

				if (state.flags.includes('--worktree')) {
					using step = steps.enterStep(Steps.ConfirmCreateWorktree);

					// Create a deferred promise to get the worktree result
					const worktreeResult = state.result ? defer<GitWorktree | undefined>() : undefined;

					const result = yield* getSteps(
						this.container,
						{
							command: 'worktree',
							state: {
								subcommand: 'create',
								reference: state.reference,
								createBranch: state.name,
								repo: state.repo,
								worktreeDefaultOpen: state.worktreeDefaultOpen,
								result: worktreeResult,
								chatAction: state.chatAction,
							},
						},
						context,
						this.startedFrom,
					);
					if (result === StepResultBreak) {
						if (step.goBack() == null) break;
						continue;
					}

					steps.markStepsComplete();

					// Capture the full result if requested
					if (worktreeResult != null && state.result != null) {
						try {
							const worktree = await worktreeResult.promise;
							if (worktree) {
								// Get the branch from the worktree repository
								const worktreeRepo = await this.container.git.getOrOpenRepository(worktree.uri);
								const branch = worktreeRepo
									? await worktreeRepo.git.branches.getBranch(state.name)
									: undefined;
								if (branch) {
									state.result.fulfill({ branch: branch, worktree: worktree });
								} else {
									state.result.cancel();
								}
							} else {
								state.result.cancel();
							}
						} catch (ex) {
							state.result.cancel(ex);
						}
					}

					return;
				}

				steps.markStepsComplete();

				if (state.flags.includes('--switch')) {
					await state.repo.switch(state.reference.ref, { createBranch: state.name });
				} else {
					try {
						await state.repo.git.branches.createBranch?.(
							state.name,
							state.reference.ref,
							isRemoteBranch && state.name !== remoteBranchName ? { noTracking: true } : undefined,
						);
					} catch (ex) {
						Logger.error(ex, context.title);

						if (BranchError.is(ex, 'alreadyExists')) {
							void window.showWarningMessage(
								`Unable to create branch '${state.name}'. A branch with that name already exists.`,
							);
							return;
						}

						if (BranchError.is(ex, 'invalidName')) {
							void window.showWarningMessage(
								`Unable to create branch '${state.name}'. The branch name is invalid.`,
							);
							return;
						}

						void showGitErrorMessage(ex, BranchError.is(ex) ? undefined : 'Unable to create branch');
						return;
					}
				}

				if (state.associateWithIssue != null) {
					const issue = state.associateWithIssue;
					const branch = await state.repo.git.branches.getBranch(state.name);
					// TODO: These descriptors are hacked in. Use an integration function to get the right resource for the issue.
					const owner = getIssueOwner(issue);
					if (branch != null && owner != null) {
						await addAssociatedIssueToBranch(this.container, branch, { ...issue, type: 'issue' }, owner);
					}
				}

				// Capture branch-only result if requested (non-worktree case)
				if (state.result && !state.flags.includes('--worktree')) {
					const branch = await state.repo.git.branches.getBranch(state.name);
					if (branch) {
						state.result.fulfill({ branch: branch, worktree: undefined });
					} else {
						state.result.cancel();
					}
				}
			}
		} finally {
			if (state.result?.pending) {
				state.result.cancel(new Error('Create Branch cancelled'));
			}
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	private *confirmStep(state: StepState<State<Repository>>, context: BranchContext): StepResultGenerator<Flags[]> {
		const confirmItems = [];
		if (!state.confirmOptions) {
			confirmItems.push(
				createFlagsQuickPickItem<Flags>(state.flags, [], {
					label: context.title,
					detail: `Will create a new branch named ${state.name} from ${getReferenceLabel(state.reference)}`,
				}),
			);
		}

		if (!state.confirmOptions || state.confirmOptions.includes('--switch')) {
			confirmItems.push(
				createFlagsQuickPickItem<Flags>(state.flags, ['--switch'], {
					label: `Create & Switch to Branch`,
					detail: `Will create and switch to a new branch named ${state.name} from ${getReferenceLabel(
						state.reference,
					)}`,
				}),
			);
		}

		if (!state.confirmOptions || state.confirmOptions.includes('--worktree')) {
			confirmItems.push(
				createFlagsQuickPickItem<Flags>(state.flags, ['--worktree'], {
					label: `${context.title} in New Worktree`,
					description: 'avoids modifying your working tree',
					detail: `Will create a new worktree for a new branch named ${state.name} from ${getReferenceLabel(
						state.reference,
					)}`,
				}),
			);
		}

		const step: QuickPickStep<FlagsQuickPickItem<Flags>> = createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			confirmItems,
			context,
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}
}
