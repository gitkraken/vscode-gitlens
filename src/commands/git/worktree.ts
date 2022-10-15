import type { MessageItem } from 'vscode';
import { QuickInputButtons, Uri, window } from 'vscode';
import * as nls from 'vscode-nls';
import { configuration } from '../../configuration';
import type { Container } from '../../container';
import { PlusFeatures } from '../../features';
import {
	WorktreeCreateError,
	WorktreeCreateErrorReason,
	WorktreeDeleteError,
	WorktreeDeleteErrorReason,
} from '../../git/errors';
import { GitReference } from '../../git/models/reference';
import type { Repository } from '../../git/models/repository';
import { GitWorktree } from '../../git/models/worktree';
import { showGenericErrorMessage } from '../../messages';
import type { QuickPickItemOfT } from '../../quickpicks/items/common';
import { QuickPickSeparator } from '../../quickpicks/items/common';
import { Directive } from '../../quickpicks/items/directive';
import { FlagsQuickPickItem } from '../../quickpicks/items/flags';
import { basename, isDescendent } from '../../system/path';
import { truncateLeft } from '../../system/string';
import { OpenWorkspaceLocation } from '../../system/utils';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase';
import { GitActions } from '../gitCommands.actions';
import type {
	AsyncStepResultGenerator,
	CustomStep,
	PartialStepState,
	QuickPickStep,
	StepGenerator,
	StepResultGenerator,
	StepSelection,
	StepState,
} from '../quickCommand';
import {
	appendReposToTitle,
	ensureAccessStep,
	inputBranchNameStep,
	pickBranchOrTagStep,
	pickRepositoryStep,
	pickWorktreesStep,
	pickWorktreeStep,
	QuickCommand,
	StepResult,
} from '../quickCommand';

const localize = nls.loadMessageBundle();

interface Context {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	defaultUri?: Uri;
	pickedUri?: Uri;
	showTags: boolean;
	title: string;
	worktrees?: GitWorktree[];
}

type CreateFlags = '--force' | '-b' | '--detach' | '--direct';

interface CreateState {
	subcommand: 'create';
	repo: string | Repository;
	uri: Uri;
	reference?: GitReference;
	createBranch: string;
	flags: CreateFlags[];
}

type DeleteFlags = '--force';

interface DeleteState {
	subcommand: 'delete';
	repo: string | Repository;
	uris: Uri[];
	flags: DeleteFlags[];
}

type OpenFlags = '--new-window' | '--reveal-explorer';

interface OpenState {
	subcommand: 'open';
	repo: string | Repository;
	uri: Uri;
	flags: OpenFlags[];
}

type State = CreateState | DeleteState | OpenState;
type WorktreeStepState<T extends State> = SomeNonNullable<StepState<T>, 'subcommand'>;
type CreateStepState<T extends CreateState = CreateState> = WorktreeStepState<ExcludeSome<T, 'repo', string>>;
type DeleteStepState<T extends DeleteState = DeleteState> = WorktreeStepState<ExcludeSome<T, 'repo', string>>;
type OpenStepState<T extends OpenState = OpenState> = WorktreeStepState<ExcludeSome<T, 'repo', string>>;

const subcommandToTitleMap = new Map<State['subcommand'], string>([
	['create', localize('subcommand.create.title', 'Create Worktree')],
	['delete', localize('subcommand.delete.title.plural', 'Delete Worktrees')],
	['open', localize('subcommand.open.title', 'Open Worktree')],
]);

function getTitle(placeholder: string, subcommand: State['subcommand'] | undefined) {
	return subcommand == null ? placeholder : subcommandToTitleMap.get(subcommand) ?? placeholder;
}

export interface WorktreeGitCommandArgs {
	readonly command: 'worktree';
	confirm?: boolean;
	state?: Partial<State>;
}

export class WorktreeGitCommand extends QuickCommand<State> {
	private subcommand: State['subcommand'] | undefined;
	private canSkipConfirmOverride: boolean | undefined;

	constructor(container: Container, args?: WorktreeGitCommandArgs) {
		super(container, 'worktree', localize('label', 'worktree'), localize('title', 'Worktree'), {
			description: localize('description', 'open, create, or delete worktrees'),
		});

		let counter = 0;
		if (args?.state?.subcommand != null) {
			counter++;

			switch (args.state.subcommand) {
				case 'create':
					if (args.state.uri != null) {
						counter++;
					}

					if (args.state.reference != null) {
						counter++;
					}

					break;
				case 'delete':
					if (args.state.uris != null && (!Array.isArray(args.state.uris) || args.state.uris.length !== 0)) {
						counter++;
					}

					break;
				case 'open':
					if (args.state.uri != null) {
						counter++;
					}

					break;
			}
		}

		if (args?.state?.repo != null) {
			counter++;
		}

		this.initialState = {
			counter: counter,
			confirm: args?.confirm,
			...args?.state,
		};
	}

	override get canConfirm(): boolean {
		return this.subcommand != null;
	}

	override get canSkipConfirm(): boolean {
		return this.canSkipConfirmOverride ?? false;
	}

	override get skipConfirmKey() {
		return `${this.key}${this.subcommand == null ? '' : `-${this.subcommand}`}:${this.pickedVia}`;
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: this.container.git.openRepositories,
			associatedView: this.container.worktreesView,
			showTags: false,
			title: this.title,
		};

		let skippedStepTwo = false;

		while (this.canStepsContinue(state)) {
			context.title = this.title;

			if (state.counter < 1 || state.subcommand == null) {
				this.subcommand = undefined;

				const result = yield* this.pickSubcommandStep(state);
				// Always break on the first step (so we will go back)
				if (result === StepResult.Break) break;

				state.subcommand = result;
			}

			this.subcommand = state.subcommand;

			if (state.counter < 2 || state.repo == null || typeof state.repo === 'string') {
				skippedStepTwo = false;
				if (context.repos.length === 1) {
					skippedStepTwo = true;
					state.counter++;

					state.repo = context.repos[0];
				} else {
					const result = yield* pickRepositoryStep(state, context);
					if (result === StepResult.Break) continue;

					state.repo = result;
				}
			}

			const result = yield* ensureAccessStep(state as any, context, PlusFeatures.Worktrees);
			if (result === StepResult.Break) break;

			context.title = getTitle(
				state.subcommand === 'delete' ? localize('title.placeholder.worktrees', 'Worktrees') : this.title,
				state.subcommand,
			);

			switch (state.subcommand) {
				case 'create': {
					yield* this.createCommandSteps(state as CreateStepState, context);
					// Clear any chosen path, since we are exiting this subcommand
					state.uri = undefined;
					break;
				}
				case 'delete': {
					if (state.uris != null && !Array.isArray(state.uris)) {
						state.uris = [state.uris];
					}

					yield* this.deleteCommandSteps(state as DeleteStepState, context);
					break;
				}
				case 'open': {
					yield* this.openCommandSteps(state as OpenStepState, context);
					break;
				}
				default:
					QuickCommand.endSteps(state);
					break;
			}

			// If we skipped the previous step, make sure we back up past it
			if (skippedStepTwo) {
				state.counter--;
			}
		}

		return state.counter < 0 ? StepResult.Break : undefined;
	}

	private *pickSubcommandStep(state: PartialStepState<State>): StepResultGenerator<State['subcommand']> {
		const step = QuickCommand.createPickStep<QuickPickItemOfT<State['subcommand']>>({
			title: this.title,
			placeholder: localize('pickSubcommandStep.placeholder', 'Choose a {0} command', this.label),
			items: [
				{
					label: localize('pickSubcommandStep.open.label', 'open'),
					description: localize('pickSubcommandStep.open.description', 'opens the specified worktree'),
					picked: state.subcommand === 'open',
					item: 'open',
				},
				{
					label: localize('pickSubcommandStep.create.label', 'create'),
					description: localize('pickSubcommandStep.create.description', 'creates a new worktree'),
					picked: state.subcommand === 'create',
					item: 'create',
				},
				{
					label: localize('pickSubcommandStep.delete.label', 'delete'),
					description: localize('pickSubcommandStep.delete.description', 'deletes the specified worktrees'),
					picked: state.subcommand === 'delete',
					item: 'delete',
				},
			],
			buttons: [QuickInputButtons.Back],
		});
		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
	}

	private async *createCommandSteps(state: CreateStepState, context: Context): AsyncStepResultGenerator<void> {
		if (context.defaultUri == null) {
			context.defaultUri = await state.repo.getWorktreesDefaultUri();
		}

		if (state.flags == null) {
			state.flags = [];
		}

		context.pickedUri = undefined;

		// Don't allow skipping the confirm step
		state.confirm = true;
		this.canSkipConfirmOverride = undefined;

		while (this.canStepsContinue(state)) {
			if (state.counter < 3 || state.reference == null) {
				const result = yield* pickBranchOrTagStep(state, context, {
					placeholder: context =>
						context.showTags
							? localize(
									'pickBranchOrTagStep.placeholder.chooseBranchOrTagToCreateNewWorktreeFor',
									'Choose a branch or tag to create the new worktree for',
							  )
							: localize(
									'pickBranchOrTagStep.placeholder.chooseBranchToCreateNewWorktreeFor',
									'Choose a branch to create the new worktree for',
							  ),
					picked: state.reference?.ref ?? (await state.repo.getBranch())?.ref,
					titleContext: ` ${localize('pickBranchOrTagStep.titleContext.for', 'for')}`,
					value: GitReference.isRevision(state.reference) ? state.reference.ref : undefined,
				});
				// Always break on the first step (so we will go back)
				if (result === StepResult.Break) break;

				state.reference = result;
			}

			if (state.counter < 4 || state.uri == null) {
				if (
					state.reference != null &&
					!configuration.get('worktrees.promptForLocation', state.repo.folder) &&
					context.defaultUri != null
				) {
					state.uri = context.defaultUri;
				} else {
					const result = yield* this.createCommandChoosePathStep(state, context, {
						titleContext: ` ${localize(
							'choosePathStep.titleContext.forRef',
							'for {0}',
							GitReference.toString(state.reference, {
								capitalize: true,
								icon: false,
								label: state.reference.refType !== 'branch',
							}),
						)}`,
					});
					if (result === StepResult.Break) continue;

					state.uri = result;
					// Keep track of the actual uri they picked, because we will modify it in later steps
					context.pickedUri = state.uri;
				}
			}

			if (this.confirm(state.confirm)) {
				const result = yield* this.createCommandConfirmStep(state, context);
				if (result === StepResult.Break) continue;

				[state.uri, state.flags] = result;
			}

			// Reset any confirmation overrides
			state.confirm = true;
			this.canSkipConfirmOverride = undefined;

			if (state.flags.includes('-b') && state.createBranch == null) {
				const result = yield* inputBranchNameStep(state, context, {
					placeholder: localize(
						'inputBranchNameStep.placeholder',
						'Please provide a name for the new branch',
					),
					titleContext: ` ${localize(
						'inputBranchNameStep.fromRef',
						'from {0}',
						GitReference.toString(state.reference, {
							capitalize: true,
							icon: false,
							label: state.reference.refType !== 'branch',
						}),
					)}`,
					value: state.createBranch ?? GitReference.getNameWithoutRemote(state.reference),
				});
				if (result === StepResult.Break) {
					// Clear the flags, since we can backup after the confirm step below (which is non-standard)
					state.flags = [];
					continue;
				}

				state.createBranch = result;
			}

			const uri = state.flags.includes('--direct')
				? state.uri
				: Uri.joinPath(
						state.uri,
						...(state.createBranch ?? state.reference.name).replace(/\\/g, '/').split('/'),
				  );

			try {
				await state.repo.createWorktree(uri, {
					commitish: state.reference?.name,
					createBranch: state.flags.includes('-b') ? state.createBranch : undefined,
					detach: state.flags.includes('--detach'),
					force: state.flags.includes('--force'),
				});
			} catch (ex) {
				if (
					WorktreeCreateError.is(ex, WorktreeCreateErrorReason.AlreadyCheckedOut) &&
					!state.flags.includes('--force')
				) {
					const createBranch: MessageItem = {
						title: localize('alreadyCheckedOutWarning.createNewBranch', 'Create New Branch'),
					};
					const force: MessageItem = {
						title: localize('alreadyCheckedOutWarning.createAnyway', 'Create Anyway'),
					};
					const cancel: MessageItem = { title: localize('cancel', 'Cancel'), isCloseAffordance: true };
					const result = await window.showWarningMessage(
						`${localize(
							'alreadyCheckedOutWarning.message.unableToCreateWorktree',
							'Unable to create the new worktree because {0} is already checked out.',
							GitReference.toString(state.reference, {
								icon: false,
								quoted: true,
							}),
						)}
						\n\n${localize(
							'alreadyCheckedOutWarning.message.wouldYouLikeToCreateNewBranchOrForceCreateAnyway',
							'Would you like to create a new branch for this worktree or forcibly create it anyway?',
						)}`,
						{ modal: true },
						createBranch,
						force,
						cancel,
					);

					if (result === createBranch) {
						state.flags.push('-b');
						this.canSkipConfirmOverride = true;
						state.confirm = false;
						continue;
					}

					if (result === force) {
						state.flags.push('--force');
						this.canSkipConfirmOverride = true;
						state.confirm = false;
						continue;
					}
				} else if (WorktreeCreateError.is(ex, WorktreeCreateErrorReason.AlreadyExists)) {
					void window.showErrorMessage(
						localize(
							'alreadyExistsError.message',
							'Unable to create a new worktree in {0} because the folder already exists and is not empty.',
							GitWorktree.getFriendlyPath(uri),
						),
						localize('ok', 'OK'),
					);
				} else {
					void showGenericErrorMessage(
						localize(
							'genericError.message',
							'Unable to create a new worktree in {0}.',
							GitWorktree.getFriendlyPath(uri),
						),
					);
				}
			}

			QuickCommand.endSteps(state);
		}
	}

	private async *createCommandChoosePathStep(
		state: CreateStepState,
		context: Context,
		options?: { titleContext?: string },
	): AsyncStepResultGenerator<Uri> {
		const step = QuickCommand.createCustomStep<Uri>({
			show: async (_step: CustomStep<Uri>) => {
				const uris = await window.showOpenDialog({
					canSelectFiles: false,
					canSelectFolders: true,
					canSelectMany: false,
					defaultUri: context.pickedUri ?? state.uri ?? context.defaultUri,
					openLabel: localize('choosePathStep.openLabel', 'Select Worktree Location'),
					title: appendReposToTitle(
						`
						${localize('choosePathStep.title', 'Choose Worktree Location')}${options?.titleContext ?? ''}`,
						state,
						context,
					),
				});

				if (uris == null || uris.length === 0) return Directive.Back;

				return uris[0];
			},
		});

		const value: StepSelection<typeof step> = yield step;

		if (
			!QuickCommand.canStepContinue(step, state, value) ||
			!(await QuickCommand.canInputStepContinue(step, state, value))
		) {
			return StepResult.Break;
		}

		return value;
	}

	private *createCommandConfirmStep(
		state: CreateStepState,
		context: Context,
	): StepResultGenerator<[Uri, CreateFlags[]]> {
		/**
		 * Here are the rules for creating the recommended path for the new worktree:
		 *
		 * If the user picks a folder outside the repo, it will be `<chosen-path>/<repo>.worktrees/<?branch>`
		 * If the user picks the repo folder, it will be `<repo>/../<repo>.worktrees/<?branch>`
		 * If the user picks a folder inside the repo, it will be `<repo>/../<repo>.worktrees/<?branch>`
		 */

		const pickedUri = context.pickedUri ?? state.uri;
		const pickedFriendlyPath = truncateLeft(GitWorktree.getFriendlyPath(pickedUri), 60);

		let canCreateDirectlyInPicked = true;
		let recommendedRootUri;

		const repoUri = state.repo.uri;
		const trailer = `${basename(repoUri.path)}.worktrees`;

		if (repoUri.toString() !== pickedUri.toString()) {
			if (isDescendent(pickedUri, repoUri)) {
				recommendedRootUri = Uri.joinPath(repoUri, '..', trailer);
			} else if (basename(pickedUri.path) === trailer) {
				recommendedRootUri = pickedUri;
			} else {
				recommendedRootUri = Uri.joinPath(pickedUri, trailer);
			}
		} else {
			recommendedRootUri = Uri.joinPath(repoUri, '..', trailer);
			// Don't allow creating directly into the main worktree folder
			canCreateDirectlyInPicked = false;
		}

		const recommendedUri =
			state.reference != null
				? Uri.joinPath(recommendedRootUri, ...state.reference.name.replace(/\\/g, '/').split('/'))
				: recommendedRootUri;
		const recommendedFriendlyPath = truncateLeft(GitWorktree.getFriendlyPath(recommendedUri), 65);

		const recommendedNewBranchFriendlyPath = truncateLeft(
			GitWorktree.getFriendlyPath(Uri.joinPath(recommendedRootUri, '<new-branch-name>')),
			60,
		);

		const step: QuickPickStep<FlagsQuickPickItem<CreateFlags, Uri>> = QuickCommand.createConfirmStep(
			appendReposToTitle(localize('confirm', 'Confirm {0}', context.title), state, context),
			[
				FlagsQuickPickItem.create<CreateFlags, Uri>(
					state.flags,
					[],
					{
						label: context.title,
						description: ` ${localize(
							'quickPick.create.description',
							'for {0}',
							GitReference.toString(state.reference),
						)}`,
						detail: localize(
							'quickPick.create.detail',
							'Will create worktree in {0}',
							`$(folder) ${recommendedFriendlyPath}`,
						),
					},
					recommendedRootUri,
				),
				FlagsQuickPickItem.create<CreateFlags, Uri>(
					state.flags,
					['-b'],
					{
						label: localize('quickPick.createBranch.label', 'Create New Branch and Worktree'),
						description: ` ${localize(
							'quickPick.createBranch.description',
							'from {0}',
							GitReference.toString(state.reference),
						)}`,
						detail: localize(
							'quickPick.createBranch.detail',
							'Will create worktree in {0}',
							`$(folder) ${recommendedNewBranchFriendlyPath}`,
						),
					},
					recommendedRootUri,
				),
				...(canCreateDirectlyInPicked
					? [
							QuickPickSeparator.create(),
							FlagsQuickPickItem.create<CreateFlags, Uri>(
								state.flags,
								['--direct'],
								{
									label: localize(
										'quickPick.createDirect.label',
										'{0} (directly in folder)',
										context.title,
									),
									description: ` ${localize(
										'quickPick.createDirect.description',
										'for {0}',
										GitReference.toString(state.reference),
									)}`,
									detail: localize(
										'quickPick.createDirect.detail',
										'Will create wokrtree directly in {0}',
										`$(folder) ${pickedFriendlyPath}`,
									),
								},
								pickedUri,
							),
							FlagsQuickPickItem.create<CreateFlags, Uri>(
								state.flags,
								['-b', '--direct'],
								{
									label: localize(
										'quickPick.createBranchDirect',
										'Create New Branch and Worktree (directly in folder)',
									),
									description: ` ${localize(
										'quickPick.description',
										'from {0}',
										GitReference.toString(state.reference),
									)}`,
									detail: localize(
										'quickPick.createBranchDirect.detail',
										'Will create worktree directly in {0}',
										`$(folder) ${pickedFriendlyPath}`,
									),
								},
								pickedUri,
							),
					  ]
					: []),
			] as FlagsQuickPickItem<CreateFlags, Uri>[],
			context,
		);
		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection)
			? [selection[0].context, selection[0].item]
			: StepResult.Break;
	}

	private async *deleteCommandSteps(state: DeleteStepState, context: Context): StepGenerator {
		context.worktrees = await state.repo.getWorktrees();

		if (state.flags == null) {
			state.flags = [];
		}

		while (this.canStepsContinue(state)) {
			if (state.counter < 3 || state.uris == null || state.uris.length === 0) {
				context.title = localize('subcommand.delete.title.plural', 'Delete Worktrees');

				const result = yield* pickWorktreesStep(state, context, {
					filter: wt => wt.main || !wt.opened, // Can't delete the main or opened worktree
					includeStatus: true,
					picked: state.uris?.map(uri => uri.toString()),
					placeholder: localize('pickWorktreesStep.placeholder', 'Choose worktrees to delete'),
				});
				// Always break on the first step (so we will go back)
				if (result === StepResult.Break) break;

				state.uris = result.map(w => w.uri);
			}

			context.title =
				state.uris.length === 1
					? localize('subcommand.delete.title', 'Delete Worktree')
					: localize('subcommand.delete.title.plural', 'Delete Worktrees');

			const result = yield* this.deleteCommandConfirmStep(state, context);
			if (result === StepResult.Break) continue;

			state.flags = result;

			QuickCommand.endSteps(state);

			for (const uri of state.uris) {
				let retry = false;
				do {
					retry = false;
					const force = state.flags.includes('--force');

					try {
						if (force) {
							const worktree = context.worktrees.find(wt => wt.uri.toString() === uri.toString());
							const status = await worktree?.getStatus();
							if (status?.hasChanges ?? false) {
								const confirm: MessageItem = {
									title: localize('deleteUncommittedChangesWarning.forceDelete', 'Force Delete'),
								};
								const cancel: MessageItem = {
									title: localize('cancel', 'Cancel'),
									isCloseAffordance: true,
								};
								const result = await window.showWarningMessage(
									`${localize(
										'deleteUncommittedChangesWarning.message.worktreeInPathHasUncommittedChanges',
										"The worktree in '{0}' has uncommitted changes.",
										uri.fsPath,
									)}
									\n\n${localize(
										'deleteUncommittedChangesWarning.message.deletingWorktreeWillCauseChangesToBeForeverLost',
										'Deleting it will cause those changes to be FOREVER LOST.',
									)}
									\n${localize('warning.thisIsIrreversible', 'This is IRREVERSIBLE!')}
									\n\n${localize(
										'deleteUncommittedChangesWarning.message.areYouSureYouWantToDeleteWorktree',
										'Are you sure you still want to delete it?',
									)}`,
									{ modal: true },
									confirm,
									cancel,
								);

								if (result !== confirm) return;
							}
						}

						await state.repo.deleteWorktree(uri, { force: force });
					} catch (ex) {
						if (WorktreeDeleteError.is(ex)) {
							if (ex.reason === WorktreeDeleteErrorReason.MainWorkingTree) {
								void window.showErrorMessage(
									localize(
										'unableToDeleteError.message.unableToDeleteMainWorktree',
										'Unable to delete the main worktree',
									),
								);
							} else if (!force) {
								const confirm: MessageItem = {
									title: localize('unableToDeleteError.forceDelete', 'Force Delete'),
								};
								const cancel: MessageItem = {
									title: localize('cancel', 'Cancel'),
									isCloseAffordance: true,
								};
								const result = await window.showErrorMessage(
									ex.reason === WorktreeDeleteErrorReason.HasChanges
										? `${localize(
												'unableToDeleteError.message.unableToDeleteWorktreeBecauseUncommittedChanges',
												"Unable to delete worktree because there are UNCOMMITTED changes in '{0}'.",
												uri.fsPath,
										  )}
										\n\n${localize(
											'unableToDeleteError.message.forciblyDeletingWorjtreeWillCauseChangesToBeForeverLost',
											'Forcibly deleting it will cause those changes to be FOREVER LOST.',
										)}
										\n${localize('warning.thisIsIrreversible', 'This is IRREVERSIBLE!')}
										\n\n${localize(
											'unableToDeleteError.message.wouldYouLikeToForceDeleteWorktree',
											'Would you like to forcibly delete it?',
										)}`
										: `${localize(
												'unableToDeleteError.message.unableToDeleteWorktreeInDir',
												"Unable to delete worktree in '{0}'.",
												uri.fsPath,
										  )}
										\n\n${localize(
											'unableToDeleteError.message.wouldYouLikeToTryToForceDeleteWorktree',
											'Would you like to try to forcibly delete it?',
										)}`,
									{ modal: true },
									confirm,
									cancel,
								);

								if (result === confirm) {
									state.flags.push('--force');
									retry = true;
								}
							}
						} else {
							void showGenericErrorMessage(
								localize(
									'genericDeleteError.message',
									"Unable to delete worktree in '{0}'",
									uri.fsPath,
								),
							);
						}
					}
				} while (retry);
			}
		}
	}

	private *deleteCommandConfirmStep(state: DeleteStepState, context: Context): StepResultGenerator<DeleteFlags[]> {
		const step: QuickPickStep<FlagsQuickPickItem<DeleteFlags>> = QuickCommand.createConfirmStep(
			appendReposToTitle(localize('confirm', 'Confirm {0}', context.title), state, context),
			[
				FlagsQuickPickItem.create<DeleteFlags>(state.flags, [], {
					label: context.title,
					detail:
						state.uris.length === 1
							? localize(
									'quickPick.delete.detail.willDeleteWorktreeInDir',
									'Will delete worktree in {0}',
									`$(folder) ${GitWorktree.getFriendlyPath(state.uris[0])}`,
							  )
							: localize(
									'quickPick.delete.detail.willDeleteWorktrees',
									'Will delete {0} worktrees',
									state.uris.length,
							  ),
				}),
				FlagsQuickPickItem.create<DeleteFlags>(state.flags, ['--force'], {
					label: localize('quickPick.forceDelete.title', 'Force {0}', context.title),
					description: localize('quickPick.forceDelete.description', 'including ANY UNCOMMITTED changes'),
					detail:
						state.uris.length === 1
							? localize(
									'quickPick.forceDelete.detail.willForciblyDeleteWorktreeInDir',
									'Will forcibly delete worktree in {0}',
									`$(folder) ${GitWorktree.getFriendlyPath(state.uris[0])}`,
							  )
							: localize(
									'quickPick.forceDelete.detail.willForciblyDeleteWorktrees',
									'Will forcibly delete {0} worktrees',
									state.uris.length,
							  ),
				}),
			],
			context,
		);

		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
	}

	private async *openCommandSteps(state: OpenStepState, context: Context): StepGenerator {
		context.worktrees = await state.repo.getWorktrees();

		if (state.flags == null) {
			state.flags = [];
		}

		while (this.canStepsContinue(state)) {
			if (state.counter < 3 || state.uri == null) {
				context.title = localize('subcommand.open.title', 'Open Worktree');

				const result = yield* pickWorktreeStep(state, context, {
					includeStatus: true,
					picked: state.uri?.toString(),
					placeholder: localize('pickWorktreeStep.placeholder', 'Choose worktree to open'),
				});
				// Always break on the first step (so we will go back)
				if (result === StepResult.Break) break;

				state.uri = result.uri;
			}

			context.title = localize('subcommand.open.title', 'Open Worktree');

			const result = yield* this.openCommandConfirmStep(state, context);
			if (result === StepResult.Break) continue;

			state.flags = result;

			QuickCommand.endSteps(state);

			const worktree = context.worktrees.find(wt => wt.uri.toString() === state.uri.toString())!;
			if (state.flags.includes('--reveal-explorer')) {
				void GitActions.Worktree.revealInFileExplorer(worktree);
			} else {
				GitActions.Worktree.open(worktree, {
					location: state.flags.includes('--new-window')
						? OpenWorkspaceLocation.NewWindow
						: OpenWorkspaceLocation.CurrentWindow,
				});
			}
		}
	}

	private *openCommandConfirmStep(state: OpenStepState, context: Context): StepResultGenerator<OpenFlags[]> {
		const step: QuickPickStep<FlagsQuickPickItem<OpenFlags>> = QuickCommand.createConfirmStep(
			appendReposToTitle(localize('confirm', 'Confirm {0}', context.title), state, context),
			[
				FlagsQuickPickItem.create<OpenFlags>(state.flags, [], {
					label: context.title,
					detail: localize(
						'quickPick.open.detail',
						'Will open, in the current window, the worktree in {0}',
						`$(folder) ${GitWorktree.getFriendlyPath(state.uri)}`,
					),
				}),
				FlagsQuickPickItem.create<OpenFlags>(state.flags, ['--new-window'], {
					label: localize('quickPick.openInNewWindow.label', '{0} in a New Window', context.title),
					detail: localize(
						'quickPick.openInNewWindow.detail',
						'Will open, in a new window, the worktree in {0}',
						`$(folder) ${GitWorktree.getFriendlyPath(state.uri)}`,
					),
				}),
				FlagsQuickPickItem.create<OpenFlags>(state.flags, ['--reveal-explorer'], {
					label: localize('quickPick.revealExplorer.label', 'Reveal in File Explorer'),
					detail: localize(
						'quickPick.revealExplorer.detail',
						'Will open, in the File Explorer, the worktree in {0}',
						`$(folder) ${GitWorktree.getFriendlyPath(state.uri)}`,
					),
				}),
			],
			context,
		);

		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
	}
}
