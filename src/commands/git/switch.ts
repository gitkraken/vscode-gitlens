import { ProgressLocation, window } from 'vscode';
import { MergeError } from '@gitlens/git/errors.js';
import type { GitReference } from '@gitlens/git/models/reference.js';
import type { GitWorktree } from '@gitlens/git/models/worktree.js';
import {
	getReferenceLabel,
	getReferenceNameWithoutRemote,
	getReferenceTypeLabel,
	isBranchReference,
} from '@gitlens/git/utils/reference.utils.js';
import { isStringArray } from '@gitlens/utils/array.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { Deferred } from '@gitlens/utils/promise.js';
import { defer } from '@gitlens/utils/promise.js';
import type { Container } from '../../container.js';
import type { GlRepository } from '../../git/models/repository.js';
import { showGitErrorMessage } from '../../messages.js';
import type { QuickPickItemOfT } from '../../quickpicks/items/common.js';
import { createQuickPickSeparator } from '../../quickpicks/items/common.js';
import type { ConfirmToggleQuickPickItem, DirectiveQuickPickItem } from '../../quickpicks/items/directive.js';
import { createConfirmToggleQuickPickItem } from '../../quickpicks/items/directive.js';
import { executeCommand } from '../../system/-webview/command.js';
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
import type { QuickPickStep } from '../quick-wizard/models/steps.quickpick.js';
import { QuickCommand } from '../quick-wizard/quickCommand.js';
import { inputBranchNameStep } from '../quick-wizard/steps/branches.js';
import { pickBranchOrTagStepMultiRepo } from '../quick-wizard/steps/references.js';
import { canSkipRepositoriesPick, pickRepositoriesStep } from '../quick-wizard/steps/repositories.js';
import { StepsController } from '../quick-wizard/stepsController.js';
import { getSteps } from '../quick-wizard/utils/quickWizard.utils.js';
import {
	appendReposToTitle,
	assertStepState,
	canPickStepContinue,
	refreshConfirmStepItems,
} from '../quick-wizard/utils/steps.utils.js';

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
	repos: GlRepository[];
	associatedView: ViewsWithRepositoryFolders;
	canSwitchToLocalBranch: GitReference | undefined;
	promptToCreateBranch: boolean;
	showTags: boolean;
	title: string;
}

interface State<Repos = string | string[] | GlRepository | GlRepository[]> {
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
	| 'switchToLocalBranchAndFastForwardViaWorktree'
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

	private async execute(state: StepState<State<GlRepository[]>>) {
		const isRemoteBranch = isBranchReference(state.reference) && state.reference.remote;
		const remoteBranchName = isRemoteBranch ? getReferenceNameWithoutRemote(state.reference) : undefined;

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
						r.git.switch(state.reference.ref, {
							createBranch: state.createBranch,
							...(isRemoteBranch && state.createBranch !== remoteBranchName
								? { noTracking: true }
								: undefined),
							progress: false,
						}),
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

	protected override get supportsSkipConfirmToggle(): boolean {
		return true;
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

		assertStepState<State<GlRepository[] | string[]>>(state);

		outer: while (!steps.isComplete) {
			context.title = this.title;

			if (steps.isAtStep(Steps.PickRepos) || !state.repos?.length || isStringArray(state.repos)) {
				// Skip the picker only when the sole available repo is the one requested
				if (canSkipRepositoriesPick(context.repos, state.repos)) {
					state.repos = context.repos;
				} else {
					using step = steps.enterStep(Steps.PickRepos);

					const result = yield* pickRepositoriesStep(state, context, step, {
						skipIfPossible: true,
					});
					if (result === StepResultBreak) {
						state.repos = undefined!;
						if (step.goBack() == null) break;
						continue;
					}

					state.repos = result;
				}
			}

			assertStepState<State<GlRepository[]>>(state);

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
				if (worktree != null) {
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
					case 'switchToLocalBranchAndFastForwardViaWorktree':
					case 'switchToNewBranchViaWorktree': {
						using step = steps.enterStep(Steps.CreateWorktree);

						// Fast-forward the branch inside the new worktree once it exists — a fresh
						// worktree has a clean tree, so `--ff-only` either advances or does nothing.
						// The deferred fulfills at creation time, before any open/window hand-off.
						let worktreeResult: Deferred<GitWorktree | undefined> | undefined;
						if (confirmResult === 'switchToLocalBranchAndFastForwardViaWorktree') {
							const fastForwardTo = state.reference;
							worktreeResult = defer<GitWorktree | undefined>();
							// The deferred REJECTS when worktree creation is cancelled or fails, and the
							// merge can fail on its own (e.g. diverged history) — both need handling, and a
							// failed fast-forward should say so like the in-place fast-forward path does
							void worktreeResult.promise.then(
								async worktree => {
									if (worktree == null) return;

									try {
										await this.container.git
											.getRepositoryService(worktree.uri.fsPath)
											.ops?.merge(fastForwardTo.ref, { fastForward: 'only' });
									} catch (ex) {
										if (MergeError.is(ex, 'aborted')) {
											Logger.debug(ex.message, this.title);
											return;
										}

										Logger.error(ex, this.title);
										void showGitErrorMessage(
											ex,
											`Unable to fast-forward ${getReferenceLabel(fastForwardTo, {
												icon: false,
												label: true,
											})}`,
										);
									}
								},
								() => {
									// Worktree creation was cancelled — nothing to fast-forward
								},
							);
						}

						const result = yield* getSteps(
							this.container,
							{
								command: 'worktree',
								state: {
									subcommand: 'create',
									reference:
										confirmResult === 'switchToLocalBranchViaWorktree' ||
										confirmResult === 'switchToLocalBranchAndFastForwardViaWorktree'
											? context.canSwitchToLocalBranch
											: state.reference,
									createBranch:
										confirmResult === 'switchToNewBranchViaWorktree'
											? state.createBranch
											: undefined,
									repo: state.repos[0],
									result: worktreeResult,
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
		state: StepState<State<GlRepository[]>>,
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

		const singleRepo = state.repos.length === 1;
		const multiRepoSuffix = state.repos.length > 1 ? ` in ${state.repos.length} repos` : '';

		// One entry per target mode — the worktree toggle rewrites label/detail/choice in place rather
		// than the old dedicated "Create Worktree for..." rows, so each mode carries its own via-worktree
		// twin (when one exists) instead of a single shared worktree row picked by ref shape.
		interface Mode {
			label: string;
			description?: string;
			detail: string;
			choice: ConfirmationChoice;
			worktreeChoice?: ConfirmationChoice;
			worktreeDetail?: string;
		}

		const modes: Mode[] = [];

		if (!isBranchReference(state.reference)) {
			modes.push({
				label: `Checkout to ${getReferenceTypeLabel(state.reference)}`,
				description: '(detached)',
				detail: `Will checkout to ${getReferenceLabel(state.reference)}${multiRepoSuffix}`,
				choice: 'switch',
			});
		}

		if (!state.createBranch) {
			if (context.canSwitchToLocalBranch != null) {
				modes.push({
					label: `Switch to Local Branch`,
					detail: `Will switch to local ${getReferenceLabel(
						context.canSwitchToLocalBranch,
					)} for ${getReferenceLabel(state.reference)}`,
					choice: 'switchToLocalBranch',
					worktreeChoice: 'switchToLocalBranchViaWorktree',
					worktreeDetail: `Will create a worktree for local ${getReferenceLabel(
						context.canSwitchToLocalBranch,
					)}`,
				});

				if (singleRepo) {
					modes.push({
						label: `Switch to Local Branch & Fast-Forward`,
						detail: `Will switch to and fast-forward local ${getReferenceLabel(
							context.canSwitchToLocalBranch,
						)}`,
						choice: 'switchToLocalBranchAndFastForward',
						worktreeChoice: 'switchToLocalBranchAndFastForwardViaWorktree',
						worktreeDetail: `Will create a worktree for local ${getReferenceLabel(
							context.canSwitchToLocalBranch,
						)} and fast-forward it`,
					});
				}
			} else if (isLocalBranch) {
				modes.push({
					label: 'Switch to Branch',
					detail: `Will switch to ${getReferenceLabel(state.reference)}${multiRepoSuffix}`,
					choice: 'switch',
					worktreeChoice: 'switchViaWorktree',
					worktreeDetail: `Will create a worktree for ${getReferenceLabel(state.reference)}`,
				});
			}
		}

		if (!isLocalBranch || state.createBranch || context.promptToCreateBranch) {
			if (isRemoteBranch) {
				modes.push({
					label: 'Create & Switch to New Local Branch',
					detail: `Will create and switch to a new local branch${
						state.createBranch ? ` named ${state.createBranch}` : ''
					} from ${getReferenceLabel(state.reference)}${multiRepoSuffix}`,
					choice: 'switchToNewBranch',
					worktreeChoice: 'switchToNewBranchViaWorktree',
					worktreeDetail: `Will create a worktree for a new local branch${
						state.createBranch ? ` named ${state.createBranch}` : ''
					} from ${getReferenceLabel(state.reference)}`,
				});
			} else {
				modes.push({
					label: `Create & Switch to New Branch from ${getReferenceTypeLabel(state.reference)}`,
					detail: `Will create and switch to a new branch${
						state.createBranch ? ` named ${state.createBranch}` : ''
					} from ${getReferenceLabel(state.reference)}${multiRepoSuffix}`,
					choice: 'switchToNewBranch',
					worktreeChoice: 'switchToNewBranchViaWorktree',
					worktreeDetail: `Will create a worktree for a new branch${
						state.createBranch ? ` named ${state.createBranch}` : ''
					} from ${getReferenceLabel(state.reference)}`,
				});
			}
		}

		if (isRemoteBranch && !state.createBranch) {
			modes.push({
				label: `Checkout to Remote Branch`,
				description: '(detached)',
				detail: `Will checkout to ${getReferenceLabel(state.reference)}`,
				choice: 'switch',
			});
		}

		// Seeded per repo from workspace storage -- a fresh confirm always starts from the sticky value,
		// then follows the toggle for the rest of this picker's lifetime
		const stored = singleRepo
			? this.container.storage.getWorkspace('gitComandPalette:switch:viaWorktree')
			: undefined;
		let viaWorktree = singleRepo ? (stored?.[state.repos[0].id] ?? false) : false;

		// Folds the live toggle value into every mode's label/detail/choice -- the accepted item's `item`
		// is the whole contract with the `steps()` switch statement, so the list says what will actually happen.
		const buildItems = (): StepType[] =>
			modes.map(mode => {
				const useWorktree = viaWorktree && mode.worktreeChoice != null;
				return {
					label: useWorktree ? `${mode.label}…` : mode.label,
					description: mode.description ?? '',
					detail: useWorktree ? mode.worktreeDetail! : mode.detail,
					item: useWorktree ? mode.worktreeChoice! : mode.choice,
				};
			});

		let step: QuickPickStep<StepType | DirectiveQuickPickItem>;

		// Takes the toggle row rather than closing over it so this can be declared before the toggle
		// itself, which needs `buildRows` in its handler.
		const buildRows = (toggle?: ConfirmToggleQuickPickItem): (StepType | DirectiveQuickPickItem)[] => {
			const items = buildItems();
			return toggle != null ? [...items, createQuickPickSeparator('Options'), toggle] : items;
		};

		let rows: (StepType | DirectiveQuickPickItem)[];
		if (singleRepo) {
			const worktreeToggle = createConfirmToggleQuickPickItem({
				label: 'In a New Worktree',
				detail: 'Switch in a separate worktree instead, leaving this working tree untouched',
				checked: viaWorktree,
				onDidChange: item => {
					viaWorktree = item.checked;
					refreshConfirmStepItems(step, buildRows(item));
				},
			});
			rows = buildRows(worktreeToggle);
		} else {
			rows = buildRows();
		}

		step = this.createConfirmStep(
			appendReposToTitle(
				`Confirm Switch to ${getReferenceLabel(state.reference, { icon: false, capitalize: true })}`,
				state,
				context,
			),
			rows,
			undefined,
			{
				placeholder: `Confirm ${context.title}`,
			},
		);
		const selection: StepSelection<typeof step> = yield step;
		if (!canPickStepContinue(step, state, selection)) return StepResultBreak;

		if (singleRepo) {
			void this.container.storage.storeWorkspace('gitComandPalette:switch:viaWorktree', {
				...stored,
				[state.repos[0].id]: viaWorktree,
			});
		}

		return selection[0].item;
	}
}
