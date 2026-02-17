import { ProgressLocation, window } from 'vscode';
import type { Container } from '../../container.js';
import { MergeError } from '../../git/errors.js';
import type { GitReference } from '../../git/models/reference.js';
import type { Repository } from '../../git/models/repository.js';
import {
	getReferenceLabel,
	getReferenceNameWithoutRemote,
	getReferenceTypeLabel,
	isBranchReference,
} from '../../git/utils/reference.utils.js';
import { showGitErrorMessage } from '../../messages.js';
import type { QuickPickItemOfT } from '../../quickpicks/items/common.js';
import { createQuickPickSeparator } from '../../quickpicks/items/common.js';
import { executeCommand } from '../../system/-webview/command.js';
import { isStringArray } from '../../system/array.js';
import { Logger } from '../../system/logger.js';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase.js';
import type {
	PartialStepState,
	StepGenerator,
	StepResultGenerator,
	StepsContext,
	StepSelection,
	StepState,
} from '../quick-wizard/models/steps.js';
import { StepResultBreak } from '../quick-wizard/models/steps.js';
import { QuickCommand } from '../quick-wizard/quickCommand.js';
import { inputBranchNameStep } from '../quick-wizard/steps/branches.js';
import { pickBranchOrTagStepMultiRepo } from '../quick-wizard/steps/references.js';
import { pickRepositoriesStep } from '../quick-wizard/steps/repositories.js';
import { StepsController } from '../quick-wizard/stepsController.js';
import { getSteps } from '../quick-wizard/utils/quickWizard.utils.js';
import { appendReposToTitle, assertStepState, canPickStepContinue } from '../quick-wizard/utils/steps.utils.js';

const Steps = {
	PickRepos: 'switch-pick-repos',
	PickBranchOrTag: 'switch-pick-branch-or-tag',
	CreateBranch: 'switch-create-branch',
	OpenWorktree: 'switch-open-worktree',
	CreateWorktree: 'switch-create-worktree',
	InputBranchName: 'switch-input-branch-name',
	Confirm: 'switch-confirm',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];

interface Context extends StepsContext<StepNames> {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	canSwitchToLocalBranch: GitReference | undefined;
	promptToCreateBranch: boolean;
	showTags: boolean;
	title: string;
}

interface State<Repos = string | string[] | Repository | Repository[]> {
	repos: Repos;
	onWorkspaceChanging?: ((isNewWorktree?: boolean) => Promise<void>) | ((isNewWorktree?: boolean) => void);
	reference: GitReference;
	createBranch?: string;
	fastForwardTo?: GitReference;
	worktreeDefaultOpen?: 'new' | 'current';
}

type ConfirmationChoice =
	| 'switch'
	| 'switchViaWorktree'
	| 'switchToLocalBranch'
	| 'switchToLocalBranchAndFastForward'
	| 'switchToLocalBranchViaWorktree'
	| 'switchToNewBranch'
	| 'switchToNewBranchViaWorktree';

export interface SwitchGitCommandArgs {
	readonly command: 'switch' | 'checkout';
	confirm?: boolean;
	state?: Partial<State>;
}

export class SwitchGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: SwitchGitCommandArgs) {
		super(container, 'switch', 'switch', 'Switch to...', {
			description: 'aka checkout, switches to a specified branch',
		});

		this.initialState = { confirm: args?.confirm, ...args?.state };
	}

	private _canConfirmOverride: boolean | undefined;
	override get canConfirm(): boolean {
		return this._canConfirmOverride ?? true;
	}

	private async execute(state: StepState<State<Repository[]>>) {
		await window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `${
					isBranchReference(state.reference) || state.createBranch ? 'Switching to' : 'Checking out'
				} ${getReferenceLabel(state.reference, { icon: false, label: false })} in ${
					state.repos.length === 1 ? state.repos[0].name : `${state.repos.length} repos`
				}`,
			},
			() =>
				Promise.all(
					state.repos.map(r =>
						r.switch(state.reference.ref, { createBranch: state.createBranch, progress: false }),
					),
				),
		);

		if (state.fastForwardTo != null) {
			try {
				await state.repos[0].git.ops?.merge(state.fastForwardTo.ref, { fastForward: 'only' });
			} catch (ex) {
				// Don't show an error message if the user intentionally aborted the merge
				if (MergeError.is(ex, 'aborted')) {
					Logger.debug(ex.message, this.title);
					return;
				}

				Logger.error(ex, this.title);
				void showGitErrorMessage(
					ex,
					`Unable to fast-forward ${getReferenceLabel(state.reference, {
						icon: false,
						label: true,
					})}`,
				);
			}
		}
	}

	override isMatch(key: string): boolean {
		return super.isMatch(key) || key === 'checkout';
	}

	override isFuzzyMatch(name: string): boolean {
		return super.isFuzzyMatch(name) || name === 'checkout';
	}

	protected createContext(context?: StepsContext<any>): Context {
		return {
			...context,
			container: this.container,
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.commits,
			canSwitchToLocalBranch: undefined,
			promptToCreateBranch: false,
			showTags: false,
			title: this.title,
		};
	}

	protected async *steps(state: PartialStepState<State>, context?: Context): StepGenerator {
		context ??= this.createContext();
		using steps = new StepsController<StepNames>(context, this);

		if (state.repos != null && !Array.isArray(state.repos)) {
			state.repos = typeof state.repos === 'string' ? [state.repos] : [state.repos];
		}

		assertStepState<State<Repository[] | string[]>>(state);

		outer: while (!steps.isComplete) {
			context.title = this.title;

			if (steps.isAtStep(Steps.PickRepos) || !state.repos?.length || isStringArray(state.repos)) {
				// Only show the picker if there are multiple repositories
				if (context.repos.length === 1) {
					state.repos = context.repos;
				} else {
					using step = steps.enterStep(Steps.PickRepos);

					const result = yield* pickRepositoriesStep(state, context, step, {
						skipIfPossible: !steps.isAtStep(Steps.PickRepos),
					});
					if (result === StepResultBreak) {
						state.repos = undefined!;
						if (step.goBack() == null) break;
						continue;
					}

					state.repos = result;
				}
			}

			assertStepState<State<Repository[]>>(state);

			if (steps.isAtStep(Steps.PickBranchOrTag) || state.reference == null) {
				using step = steps.enterStep(Steps.PickBranchOrTag);

				const result = yield* pickBranchOrTagStepMultiRepo(state, context, {
					placeholder: context => `Choose a branch${context.showTags ? ' or tag' : ''} to switch to`,
					allowCreate: state.repos.length === 1,
				});
				if (result === StepResultBreak) {
					state.reference = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				if (result.type === 'action') {
					switch (result.action) {
						case 'create-branch': {
							using createStep = steps.enterStep(Steps.CreateBranch);

							const createResult = yield* getSteps(
								this.container,
								{
									command: 'branch',
									state: {
										subcommand: 'create',
										repo: state.repos[0],
										suggestedName: result.name,
										flags: ['--switch'],
									},
								},
								context,
								this.startedFrom,
							);
							if (createResult === StepResultBreak) {
								if (createStep.goBack() == null) break;
								continue;
							}

							steps.markStepsComplete();
							return;
						}
						case 'cross-command':
							void executeCommand(result.command, result.args);
							steps.markStepsComplete();
							return;
					}
					continue;
				}

				state.reference = result.value;
			}

			context.canSwitchToLocalBranch = undefined;

			const svc = this.container.git.getRepositoryService(state.reference.repoPath);

			if (isBranchReference(state.reference) && !state.reference.remote) {
				state.createBranch = undefined;

				const worktree = await svc.worktrees?.getWorktree(w => w.branch?.name === state.reference.name);
				if (worktree != null && !worktree.isDefault) {
					if (state.fastForwardTo != null) {
						try {
							await state.repos[0].git.ops?.merge(state.fastForwardTo.ref, { fastForward: 'only' });
						} catch (ex) {
							// Don't show an error message if the user intentionally aborted the merge
							if (MergeError.is(ex, 'aborted')) {
								Logger.debug(ex.message, this.title);
							} else {
								Logger.error(ex, this.title);
								void showGitErrorMessage(
									ex,
									`Unable to fast-forward ${getReferenceLabel(state.reference, {
										icon: false,
										label: true,
									})}`,
								);
							}
						}
					}

					using step = steps.enterStep(Steps.OpenWorktree);

					const result = yield* getSteps(
						this.container,
						{
							command: 'worktree',
							state: {
								subcommand: 'open',
								worktree: worktree,
								openOnly: true,
								overrides: {
									canGoBack: false,
									confirmation: state.worktreeDefaultOpen
										? undefined
										: {
												title: `Confirm Switch to Worktree \u2022 ${getReferenceLabel(
													state.reference,
													{
														icon: false,
														label: false,
													},
												)}`,
												placeholder: `${getReferenceLabel(state.reference, {
													capitalize: true,
													icon: false,
												})} is linked to a worktree`,
											},
								},
								onWorkspaceChanging: state.onWorkspaceChanging,
								repo: state.repos[0],
								worktreeDefaultOpen: state.worktreeDefaultOpen,
							},
						},
						context,
						this.startedFrom,
					);
					if (result === StepResultBreak) {
						if (!state.worktreeDefaultOpen) {
							if (step.goBack() == null) break;
							continue;
						}
					}

					steps.markStepsComplete();
					return;
				}
			} else if (isBranchReference(state.reference) && state.reference.remote) {
				// See if there is a local branch that tracks the remote branch
				const { values: branches } = await svc.branches.getBranches({
					filter: b => b.upstream?.name === state.reference.name,
					sort: { orderBy: 'date:desc' },
				});

				if (branches.length) {
					context.canSwitchToLocalBranch = branches[0];

					state.createBranch = undefined;
					context.promptToCreateBranch = false;
					if (state.worktreeDefaultOpen) {
						state.reference = context.canSwitchToLocalBranch;
						continue outer;
					}
				} else {
					context.promptToCreateBranch = true;
				}
			}

			if (
				state.worktreeDefaultOpen ||
				this.confirm(context.promptToCreateBranch || context.canSwitchToLocalBranch ? true : state.confirm)
			) {
				using step = steps.enterStep(Steps.Confirm);

				const confirmResult = yield* this.confirmStep(state, context);
				if (confirmResult === StepResultBreak) {
					if (step.goBack() == null) break;
					continue;
				}

				switch (confirmResult) {
					case 'switchToLocalBranch':
						state.reference = context.canSwitchToLocalBranch!;
						continue outer;

					case 'switchToLocalBranchAndFastForward':
						state.fastForwardTo = state.reference;
						state.reference = context.canSwitchToLocalBranch!;
						continue outer;

					case 'switchToNewBranch': {
						using step = steps.enterStep(Steps.InputBranchName);

						context.title = `Switch to New Branch`;
						this._canConfirmOverride = false;

						const result = yield* inputBranchNameStep(state, context, {
							prompt: 'Please provide a name for the new branch',
							title: `${context.title} from ${getReferenceLabel(state.reference, {
								capitalize: true,
								icon: false,
								label: state.reference.refType !== 'branch',
							})}`,
							value:
								state.createBranch ?? // if it's a remote branch, pre-fill the name
								(isBranchReference(state.reference) && state.reference.remote
									? getReferenceNameWithoutRemote(state.reference)
									: undefined),
						});

						this._canConfirmOverride = undefined;

						if (result === StepResultBreak) {
							state.createBranch = undefined;
							if (step.goBack() == null) break;
							continue outer;
						}

						state.createBranch = result;
						break;
					}
					case 'switchViaWorktree':
					case 'switchToLocalBranchViaWorktree':
					case 'switchToNewBranchViaWorktree': {
						using step = steps.enterStep(Steps.CreateWorktree);

						const result = yield* getSteps(
							this.container,
							{
								command: 'worktree',
								state: {
									subcommand: 'create',
									reference:
										confirmResult === 'switchToLocalBranchViaWorktree'
											? context.canSwitchToLocalBranch
											: state.reference,
									createBranch:
										confirmResult === 'switchToNewBranchViaWorktree'
											? state.createBranch
											: undefined,
									repo: state.repos[0],
									onWorkspaceChanging: state.onWorkspaceChanging,
									worktreeDefaultOpen: state.worktreeDefaultOpen,
								},
							},
							context,
							this.startedFrom,
						);
						if (result === StepResultBreak) {
							if (!state.worktreeDefaultOpen) {
								if (step.goBack() == null) break;
								continue outer;
							}
						}

						steps.markStepsComplete();
						return;
					}
				}
			}

			steps.markStepsComplete();
			void this.execute(state);
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	private *confirmStep(
		state: StepState<State<Repository[]>>,
		context: Context,
	): StepResultGenerator<ConfirmationChoice> {
		const isLocalBranch = isBranchReference(state.reference) && !state.reference.remote;
		const isRemoteBranch = isBranchReference(state.reference) && state.reference.remote;

		type StepType = QuickPickItemOfT<ConfirmationChoice>;
		if (state.worktreeDefaultOpen && state.repos.length === 1) {
			if (isLocalBranch) {
				return 'switchViaWorktree';
			} else if (!state.createBranch && context.canSwitchToLocalBranch != null) {
				return 'switchToLocalBranchViaWorktree';
			}

			return 'switchToNewBranchViaWorktree';
		}

		const confirmations: StepType[] = [];

		if (!isBranchReference(state.reference)) {
			confirmations.push({
				label: `Checkout to ${getReferenceTypeLabel(state.reference)}`,
				description: '(detached)',
				detail: `Will checkout to ${getReferenceLabel(state.reference)}${
					state.repos.length > 1 ? ` in ${state.repos.length} repos` : ''
				}`,
				item: 'switch',
			});
		}

		if (!state.createBranch) {
			if (context.canSwitchToLocalBranch != null) {
				confirmations.push(createQuickPickSeparator('Local'));
				confirmations.push({
					label: `Switch to Local Branch`,
					description: '',
					detail: `Will switch to local ${getReferenceLabel(
						context.canSwitchToLocalBranch,
					)} for ${getReferenceLabel(state.reference)}`,
					item: 'switchToLocalBranch',
				});

				if (state.repos.length === 1) {
					confirmations.push({
						label: `Switch to Local Branch & Fast-Forward`,
						description: '',
						detail: `Will switch to and fast-forward local ${getReferenceLabel(
							context.canSwitchToLocalBranch,
						)}`,
						item: 'switchToLocalBranchAndFastForward',
					});
				}
			} else if (isLocalBranch) {
				confirmations.push({
					label: 'Switch to Branch',
					description: '',
					detail: `Will switch to ${getReferenceLabel(state.reference)}${
						state.repos.length > 1 ? ` in ${state.repos.length} repos` : ''
					}`,
					item: 'switch',
				});
			}
		}

		if (!isLocalBranch || state.createBranch || context.promptToCreateBranch) {
			if (isRemoteBranch) {
				if (confirmations.length) {
					confirmations.push(createQuickPickSeparator('Remote'));
				}
				confirmations.push({
					label: 'Create & Switch to New Local Branch',
					description: '',
					detail: `Will create and switch to a new local branch${
						state.createBranch ? ` named ${state.createBranch}` : ''
					} from ${getReferenceLabel(state.reference)}${
						state.repos.length > 1 ? ` in ${state.repos.length} repos` : ''
					}`,
					item: 'switchToNewBranch',
				});
			} else {
				if (confirmations.length) {
					confirmations.push(createQuickPickSeparator('Branch'));
				}
				confirmations.push({
					label: `Create & Switch to New Branch from ${getReferenceTypeLabel(state.reference)}`,
					description: '',
					detail: `Will create and switch to a new branch${
						state.createBranch ? ` named ${state.createBranch}` : ''
					} from ${getReferenceLabel(state.reference)}${
						state.repos.length > 1 ? ` in ${state.repos.length} repos` : ''
					}`,
					item: 'switchToNewBranch',
				});
			}
		}

		if (state.repos.length === 1) {
			if (confirmations.length) {
				confirmations.push(createQuickPickSeparator('Worktree'));
			}
			if (isLocalBranch) {
				confirmations.push({
					label: `Create Worktree for Branch...`,
					description: 'avoids modifying your working tree',
					detail: `Will create a new worktree for ${getReferenceLabel(state.reference)}`,
					item: 'switchViaWorktree',
				});
			} else if (!state.createBranch && context.canSwitchToLocalBranch != null) {
				confirmations.push({
					label: `Create Worktree for Local Branch...`,
					description: 'avoids modifying your working tree',
					detail: `Will create a new worktree for local ${getReferenceLabel(context.canSwitchToLocalBranch)}`,
					item: 'switchToLocalBranchViaWorktree',
				});
			} else if (isRemoteBranch) {
				confirmations.push({
					label: `Create Worktree for New Local Branch...`,
					description: 'avoids modifying your working tree',
					detail: `Will create a new worktree for a new local branch${
						state.createBranch ? ` named ${state.createBranch}` : ''
					} from ${getReferenceLabel(state.reference)}${
						state.repos.length > 1 ? ` in ${state.repos.length} repos` : ''
					}`,
					item: 'switchToNewBranchViaWorktree',
				});
			} else {
				confirmations.push({
					label: `Create Worktree for New Branch from ${getReferenceTypeLabel(state.reference)}...`,
					description: 'avoids modifying your working tree',
					detail: `Will create a new worktree for a new branch${
						state.createBranch ? ` named ${state.createBranch}` : ''
					} from ${getReferenceLabel(state.reference)}${
						state.repos.length > 1 ? ` in ${state.repos.length} repos` : ''
					}`,
					item: 'switchToNewBranchViaWorktree',
				});
			}
		}

		if (isRemoteBranch && !state.createBranch) {
			if (confirmations.length) {
				confirmations.push(createQuickPickSeparator('Checkout'));
			}
			confirmations.push({
				label: `Checkout to Remote Branch`,
				description: '(detached)',
				detail: `Will checkout to ${getReferenceLabel(state.reference)}`,
				item: 'switch',
			});
		}

		const step = this.createConfirmStep(
			appendReposToTitle(
				`Confirm Switch to ${getReferenceLabel(state.reference, { icon: false, capitalize: true })}`,
				state,
				context,
			),
			confirmations,
			undefined,
			{
				placeholder: `Confirm ${context.title}`,
			},
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}
}
