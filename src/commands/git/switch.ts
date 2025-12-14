import { ProgressLocation, window } from 'vscode';
import type { Container } from '../../container';
import { MergeError } from '../../git/errors';
import type { GitReference } from '../../git/models/reference';
import type { Repository } from '../../git/models/repository';
import {
	getReferenceLabel,
	getReferenceNameWithoutRemote,
	getReferenceTypeLabel,
	isBranchReference,
} from '../../git/utils/reference.utils';
import { showGitErrorMessage } from '../../messages';
import type { QuickPickItemOfT } from '../../quickpicks/items/common';
import { createQuickPickSeparator } from '../../quickpicks/items/common';
import { executeCommand } from '../../system/-webview/command';
import { isStringArray } from '../../system/array';
import { Logger } from '../../system/logger';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase';
import type { PartialStepState, StepGenerator, StepResultGenerator, StepSelection, StepState } from '../quickCommand';
import { canPickStepContinue, endSteps, isCrossCommandReference, QuickCommand, StepResultBreak } from '../quickCommand';
import {
	appendReposToTitle,
	inputBranchNameStep,
	pickBranchOrTagStepMultiRepo,
	pickRepositoriesStep,
} from '../quickCommand.steps';
import { getSteps } from '../quickWizard.utils';

interface Context {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	canSwitchToLocalBranch: GitReference | undefined;
	promptToCreateBranch: boolean;
	showTags: boolean;
	title: string;
}

interface State {
	repos: string | string[] | Repository | Repository[];
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

type SwitchStepState<T extends State = State> = ExcludeSome<StepState<T>, 'repos', string | string[] | Repository>;

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

		let counter = 0;
		if (args?.state?.repos != null && (!Array.isArray(args.state.repos) || args.state.repos.length !== 0)) {
			counter++;
		}

		if (args?.state?.reference != null) {
			counter++;
		}

		this.initialState = {
			counter: counter,
			confirm: args?.confirm,
			...args?.state,
		};
	}

	private _canConfirmOverride: boolean | undefined;
	override get canConfirm(): boolean {
		return this._canConfirmOverride ?? true;
	}

	private async execute(state: SwitchStepState) {
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
					Logger.log(ex.message, this.title);
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

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.commits,
			canSwitchToLocalBranch: undefined,
			promptToCreateBranch: false,
			showTags: false,
			title: this.title,
		};

		if (state.repos != null && !Array.isArray(state.repos)) {
			state.repos = [state.repos] as string[] | Repository[];
		}

		let skippedStepOne = false;

		outer: while (this.canStepsContinue(state)) {
			context.title = this.title;

			if (state.counter < 1 || state.repos == null || state.repos.length === 0 || isStringArray(state.repos)) {
				skippedStepOne = false;
				if (context.repos.length === 1) {
					skippedStepOne = true;
					if (state.repos == null) {
						state.counter++;
					}

					state.repos = [context.repos[0]];
				} else {
					const result = yield* pickRepositoriesStep(
						state as ExcludeSome<typeof state, 'repos', string | Repository>,
						context,
						{ skipIfPossible: state.counter >= 1 },
					);
					// Always break on the first step (so we will go back)
					if (result === StepResultBreak) break;

					state.repos = result;
				}
			}

			if (state.counter < 2 || state.reference == null) {
				const result = yield* pickBranchOrTagStepMultiRepo(state as SwitchStepState, context, {
					placeholder: context => `Choose a branch${context.showTags ? ' or tag' : ''} to switch to`,
					allowCreate: state.repos.length === 1,
				});
				if (result === StepResultBreak) {
					// If we skipped the previous step, make sure we back up past it
					if (skippedStepOne) {
						state.counter--;
					}

					continue;
				}

				if (typeof result === 'string') {
					yield* getSteps(
						this.container,
						{
							command: 'branch',
							state: {
								subcommand: 'create',
								repo: state.repos[0],
								name: result,
								suggestNameOnly: true,
								flags: ['--switch'],
							},
						},
						this.pickedVia,
					);

					endSteps(state);
					return;
				}

				if (isCrossCommandReference(result)) {
					void executeCommand(result.command, result.args);
					endSteps(state);
					return;
				}

				state.reference = result;
			}

			context.canSwitchToLocalBranch = undefined;

			const svc = this.container.git.getRepositoryService(state.reference.repoPath);

			if (isBranchReference(state.reference) && !state.reference.remote) {
				state.createBranch = undefined;

				const worktree = await svc.worktrees?.getWorktree(w => w.branch?.name === state.reference!.name);
				if (worktree != null && !worktree.isDefault) {
					if (state.fastForwardTo != null) {
						try {
							await state.repos[0].git.ops?.merge(state.fastForwardTo.ref, { fastForward: 'only' });
						} catch (ex) {
							// Don't show an error message if the user intentionally aborted the merge
							if (MergeError.is(ex, 'aborted')) {
								Logger.log(ex.message, this.title);
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

					const worktreeResult = yield* getSteps(
						this.container,
						{
							command: 'worktree',
							state: {
								subcommand: 'open',
								worktree: worktree,
								openOnly: true,
								overrides: {
									disallowBack: true,
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
						this.pickedVia,
					);
					if (worktreeResult === StepResultBreak && !state.worktreeDefaultOpen) continue;

					endSteps(state);
					return;
				}
			} else if (isBranchReference(state.reference) && state.reference.remote) {
				// See if there is a local branch that tracks the remote branch
				const { values: branches } = await svc.branches.getBranches({
					filter: b => b.upstream?.name === state.reference!.name,
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
				const result = yield* this.confirmStep(state as SwitchStepState, context);
				if (result === StepResultBreak) continue;

				switch (result) {
					case 'switchToLocalBranch':
						state.reference = context.canSwitchToLocalBranch!;
						continue outer;

					case 'switchToLocalBranchAndFastForward':
						state.fastForwardTo = state.reference;
						state.reference = context.canSwitchToLocalBranch!;
						continue outer;

					case 'switchToNewBranch': {
						context.title = `Switch to New Branch`;
						this._canConfirmOverride = false;

						const result = yield* inputBranchNameStep(state as SwitchStepState, context, {
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

						if (result === StepResultBreak) continue outer;

						state.createBranch = result;
						break;
					}
					case 'switchViaWorktree':
					case 'switchToLocalBranchViaWorktree':
					case 'switchToNewBranchViaWorktree': {
						const worktreeResult = yield* getSteps(
							this.container,
							{
								command: 'worktree',
								state: {
									subcommand: 'create',
									reference:
										result === 'switchToLocalBranchViaWorktree'
											? context.canSwitchToLocalBranch
											: state.reference,
									createBranch:
										result === 'switchToNewBranchViaWorktree' ? state.createBranch : undefined,
									repo: state.repos[0],
									onWorkspaceChanging: state.onWorkspaceChanging,
									worktreeDefaultOpen: state.worktreeDefaultOpen,
								},
							},
							this.pickedVia,
						);
						if (worktreeResult === StepResultBreak && !state.worktreeDefaultOpen) continue outer;

						endSteps(state);
						return;
					}
				}
			}

			endSteps(state);
			void this.execute(state as SwitchStepState);
		}

		return state.counter < 0 ? StepResultBreak : undefined;
	}

	private *confirmStep(state: SwitchStepState, context: Context): StepResultGenerator<ConfirmationChoice> {
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
