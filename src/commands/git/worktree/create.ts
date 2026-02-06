import type { MessageItem } from 'vscode';
import { Uri, window, workspace } from 'vscode';
import type { Config } from '../../../config.js';
import type { Container } from '../../../container.js';
import { convertLocationToOpenFlags, revealWorktree } from '../../../git/actions/worktree.js';
import { WorktreeCreateError } from '../../../git/errors.js';
import type { GitReference } from '../../../git/models/reference.js';
import type { Repository } from '../../../git/models/repository.js';
import type { GitWorktree } from '../../../git/models/worktree.js';
import { getWorktreeForBranch } from '../../../git/utils/-webview/worktree.utils.js';
import {
	getReferenceLabel,
	getReferenceNameWithoutRemote,
	isBranchReference,
	isRevisionReference,
} from '../../../git/utils/reference.utils.js';
import { showGitErrorMessage } from '../../../messages.js';
import type { ChatActions } from '../../../plus/chat/chatActions.js';
import { storeChatActionDeepLink } from '../../../plus/chat/chatActions.js';
import { createQuickPickSeparator } from '../../../quickpicks/items/common.js';
import { Directive } from '../../../quickpicks/items/directive.js';
import type { FlagsQuickPickItem } from '../../../quickpicks/items/flags.js';
import { createFlagsQuickPickItem } from '../../../quickpicks/items/flags.js';
import { configuration } from '../../../system/-webview/configuration.js';
import { isDescendant } from '../../../system/-webview/path.js';
import { getWorkspaceFriendlyPath } from '../../../system/-webview/vscode/workspaces.js';
import { revealInFileExplorer } from '../../../system/-webview/vscode.js';
import { basename } from '../../../system/path.js';
import type { Deferred } from '../../../system/promise.js';
import { truncateLeft } from '../../../system/string.js';
import type { CustomStep } from '../../quick-wizard/models/steps.custom.js';
import type {
	PartialStepState,
	StepGenerator,
	StepResultGenerator,
	StepsContext,
	StepSelection,
	StepState,
} from '../../quick-wizard/models/steps.js';
import { StepResultBreak } from '../../quick-wizard/models/steps.js';
import { QuickCommand } from '../../quick-wizard/quickCommand.js';
import { ensureAccessStep } from '../../quick-wizard/steps/access.js';
import { inputBranchNameStep } from '../../quick-wizard/steps/branches.js';
import { pickBranchOrTagStep } from '../../quick-wizard/steps/references.js';
import { pickRepositoryStep } from '../../quick-wizard/steps/repositories.js';
import { StepsController } from '../../quick-wizard/stepsController.js';
import { getSteps } from '../../quick-wizard/utils/quickWizard.utils.js';
import {
	appendReposToTitle,
	assertStepState,
	canPickStepContinue,
	canStepContinue,
	createConfirmStep,
	createCustomStep,
} from '../../quick-wizard/utils/steps.utils.js';
import type { WorktreeContext } from '../worktree.js';
import type { WorktreeOpenState } from './open.js';

const Steps = {
	PickRepo: 'worktree-create-pick-repo',
	EnsureAccess: 'worktree-create-ensure-access',
	PickRef: 'worktree-create-pick-ref',
	InputBranchName: 'worktree-create-input-branch-name',
	Confirm: 'worktree-create-confirm',
	ConfirmChoosePath: 'worktree-create-confirm-choose-path',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];
export type WorktreeCreateStepNames = StepNames;

type Context = WorktreeContext<StepNames>;

type ConfirmationChoice = Uri | 'changeRoot' | 'chooseFolder';
type Flags = '--force' | '-b' | '--detach' | '--direct';
interface State<Repo = string | Repository> {
	repo: Repo;
	worktree?: GitWorktree;
	uri: Uri;
	reference?: GitReference;
	addRemote?: { name: string; url: string };
	createBranch?: string;
	flags: Flags[];

	result?: Deferred<GitWorktree | undefined>;
	reveal?: boolean;

	overrides?: {
		title?: string;
	};

	onWorkspaceChanging?: ((isNewWorktree?: boolean) => Promise<void>) | ((isNewWorktree?: boolean) => void);
	worktreeDefaultOpen?: 'new' | 'current';

	// Chat action for deeplink storage
	chatAction?: ChatActions;
}
export type WorktreeCreateState = State;

export interface WorktreeCreateGitCommandArgs {
	readonly command: 'worktree-create';
	confirm?: boolean;
	state?: Partial<State>;
}

export class WorktreeCreateGitCommand extends QuickCommand<State> {
	private _canSkipConfirmOverride: boolean | undefined;

	constructor(container: Container, args?: WorktreeCreateGitCommandArgs) {
		super(container, 'worktree-create', 'create', 'Create Worktree', {
			description: 'creates a new worktree',
		});

		this.initialState = { confirm: args?.confirm, flags: [], ...args?.state };
	}

	override get canSkipConfirm(): boolean {
		return this._canSkipConfirmOverride ?? false;
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
		// Don't allow skipping the confirm step
		state.confirm = true;
		this._canSkipConfirmOverride = undefined;

		let setCreateBranchFlag = false;

		try {
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

				context.defaultUri ??= state.repo.git.worktrees?.getWorktreesDefaultUri();
				context.pickedRootFolder = undefined;
				context.pickedSpecificFolder = undefined;

				if (steps.isAtStep(Steps.PickRef) || state.reference == null) {
					using step = steps.enterStep(Steps.PickRef);

					const result = yield* pickBranchOrTagStep(state, context, {
						placeholder: ctx =>
							`Choose a branch${ctx.showTags ? ' or tag' : ''} to create the new worktree from`,
						picked: state.reference?.ref ?? (await state.repo.git.branches.getBranch())?.ref,
						title: `Select Branch to Create Worktree From`,
						value: isRevisionReference(state.reference) ? state.reference.ref : undefined,
					});
					if (result === StepResultBreak) {
						state.reference = undefined!;
						if (step.goBack() == null) break;
						continue;
					}

					state.reference = result;
					if (setCreateBranchFlag) {
						state.flags = state.flags.filter(f => f !== '-b');
						setCreateBranchFlag = false;
					}
				}

				state.uri ??= context.defaultUri!;

				state.worktree =
					isBranchReference(state.reference) && !state.reference.remote
						? await getWorktreeForBranch(state.repo, state.reference.name, undefined, context.worktrees)
						: undefined;

				const isRemoteBranch = isBranchReference(state.reference) && state.reference?.remote;
				if ((isRemoteBranch || state.worktree != null) && !state.flags.includes('-b')) {
					setCreateBranchFlag = true;
					state.flags.push('-b');
				} else {
					setCreateBranchFlag = false;
				}

				if (isRemoteBranch) {
					state.createBranch = getReferenceNameWithoutRemote(state.reference);
					const branch = await state.repo.git.branches.getBranch(state.createBranch);
					if (branch != null && !branch.remote) {
						state.createBranch = branch.name;
					}
				}

				if (state.flags.includes('-b')) {
					let createBranchOverride: string | undefined;
					if (state.createBranch != null) {
						let valid = await state.repo.git.refs.checkIfCouldBeValidBranchOrTagName(state.createBranch);
						if (valid) {
							const alreadyExists = await state.repo.git.branches.getBranch(state.createBranch);
							valid = alreadyExists == null;
						}

						if (!valid) {
							createBranchOverride = state.createBranch;
							state.createBranch = undefined;
						}
					}

					if (steps.isAtStep(Steps.InputBranchName) || state.createBranch == null) {
						using step = steps.enterStep(Steps.InputBranchName);

						const result = yield* inputBranchNameStep(state, context, {
							prompt: 'Please provide a name for the new branch',
							title: `${context.title} and New Branch from ${getReferenceLabel(state.reference, {
								capitalize: true,
								icon: false,
								label: state.reference.refType !== 'branch',
							})}`,
							value: createBranchOverride,
						});
						if (result === StepResultBreak) {
							state.createBranch = undefined;
							if (step.goBack() == null) break;
							continue;
						}

						state.createBranch = result;
					}
				}

				if (this.confirm(state.confirm)) {
					using step = steps.enterStep(Steps.Confirm);

					const result = yield* this.confirmStep(state, context);
					if (result === StepResultBreak) {
						state.uri = undefined!;
						if (step.goBack() == null) break;
						continue;
					}

					if (typeof result[0] === 'string') {
						switch (result[0]) {
							case 'changeRoot': {
								using pathStep = steps.enterStep(Steps.ConfirmChoosePath);

								const pathResult = yield* this.choosePathStep(state, context, {
									title: `Choose a Different Root Folder for this Worktree`,
									label: 'Choose Root Folder',
									pickedUri: context.pickedRootFolder,
									defaultUri: context.pickedRootFolder ?? context.defaultUri,
								});
								if (pathResult === StepResultBreak) {
									state.uri = undefined!;
									if (pathStep.goBack() == null) break;
									continue;
								}

								state.uri = pathResult;
								// Keep track of the actual uri they picked, because we will modify it in later steps
								context.pickedRootFolder = state.uri;
								context.pickedSpecificFolder = undefined;
								return;
							}
							case 'chooseFolder': {
								using pathStep = steps.enterStep(Steps.ConfirmChoosePath);

								const pathResult = yield* this.choosePathStep(state, context, {
									title: `Choose a Specific Folder for this Worktree`,
									label: 'Choose Worktree Folder',
									pickedUri: context.pickedRootFolder,
									defaultUri: context.pickedSpecificFolder ?? context.defaultUri,
								});
								if (pathResult === StepResultBreak) {
									state.uri = undefined!;
									if (pathStep.goBack() == null) break;
									continue;
								}

								state.uri = pathResult;
								// Keep track of the actual uri they picked, because we will modify it in later steps
								context.pickedRootFolder = undefined;
								context.pickedSpecificFolder = state.uri;
								return;
							}
						}
					}

					state.uri = result[0] as Uri;
					state.flags = result[1];
				}

				// Reset any confirmation overrides
				state.confirm = true;
				this._canSkipConfirmOverride = undefined;

				const uri = state.flags.includes('--direct')
					? state.uri
					: Uri.joinPath(
							state.uri,
							...(state.createBranch ?? state.reference.name).replace(/\\/g, '/').split('/'),
						);

				let worktree: GitWorktree | undefined;
				try {
					if (state.addRemote != null) {
						await state.repo.git.remotes.addRemote?.(state.addRemote.name, state.addRemote.url, {
							fetch: true,
						});
					}

					worktree = await state.repo.git.worktrees?.createWorktreeWithResult(uri.fsPath, {
						commitish: state.reference?.name,
						createBranch: state.flags.includes('-b') ? state.createBranch : undefined,
						detach: state.flags.includes('--detach'),
						force: state.flags.includes('--force'),
					});
					state.result?.fulfill(worktree);

					// Store deeplink before opening worktree (if this is a chat action flow)
					if (state.chatAction && worktree) {
						await storeChatActionDeepLink(this.container, state.chatAction, worktree.uri.fsPath);
					}
				} catch (ex) {
					if (WorktreeCreateError.is(ex, 'alreadyCheckedOut') && !state.flags.includes('--force')) {
						const createBranch: MessageItem = { title: 'Create New Branch' };
						const force: MessageItem = { title: 'Create Anyway' };
						const cancel: MessageItem = { title: 'Cancel', isCloseAffordance: true };
						const result = await window.showWarningMessage(
							`Unable to create the new worktree because ${getReferenceLabel(state.reference, {
								icon: false,
								quoted: true,
							})} is already checked out.\n\nWould you like to create a new branch for this worktree or forcibly create it anyway?`,
							{ modal: true },
							createBranch,
							force,
							cancel,
						);

						if (result === createBranch) {
							state.flags.push('-b');
							this._canSkipConfirmOverride = true;
							state.confirm = false;
							return;
						}

						if (result === force) {
							state.flags.push('--force');
							this._canSkipConfirmOverride = true;
							state.confirm = false;
							return;
						}
					} else if (WorktreeCreateError.is(ex, 'alreadyExists')) {
						const confirm: MessageItem = { title: 'OK' };
						const openFolder: MessageItem = { title: 'Open Folder' };
						void window
							.showErrorMessage(
								`Unable to create a new worktree in '${getWorkspaceFriendlyPath(
									uri,
								)}' because the folder already exists and is not empty.`,
								confirm,
								openFolder,
							)
							.then(result => {
								if (result === openFolder) {
									void revealInFileExplorer(uri);
								}
							});
					} else {
						void showGitErrorMessage(
							ex,
							`Unable to create a new worktree in '${getWorkspaceFriendlyPath(uri)}.`,
						);
					}
				}

				steps.markStepsComplete();

				if (worktree == null) return StepResultBreak;

				if (state.reveal !== false) {
					setTimeout(() => {
						if (this.container.views.worktrees.visible) {
							void revealWorktree(worktree, { select: true, focus: false });
						}
					}, 100);
				}

				type OpenAction = Config['worktrees']['openAfterCreate'];
				const action: OpenAction = configuration.get('worktrees.openAfterCreate');
				if (action !== 'never') {
					let flags: WorktreeOpenState['flags'];
					switch (action) {
						case 'always':
							flags = convertLocationToOpenFlags('currentWindow');
							break;
						case 'alwaysNewWindow':
							flags = convertLocationToOpenFlags('newWindow');
							break;
						case 'onlyWhenEmpty':
							flags = convertLocationToOpenFlags(
								workspace.workspaceFolders?.length ? 'newWindow' : 'currentWindow',
							);
							break;
						default:
							flags = [];
							break;
					}

					yield* getSteps(
						this.container,
						{
							command: 'worktree',
							confirm: action === 'prompt',
							state: {
								subcommand: 'open',
								repo: state.repo,
								worktree: worktree,
								flags: flags,
								openOnly: true,
								overrides: { canGoBack: false },
								isNewWorktree: true,
								worktreeDefaultOpen: state.worktreeDefaultOpen,
								onWorkspaceChanging: state.onWorkspaceChanging,
							},
						},
						context,
						this.startedFrom,
					);
					break;
				}
			}
		} finally {
			if (state.result?.pending) {
				state.result.cancel(new Error('Create Worktree cancelled'));
			}
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	private *choosePathStep(
		state: StepState<State<Repository>>,
		context: Context,
		options: { title: string; label: string; pickedUri: Uri | undefined; defaultUri?: Uri },
	): StepResultGenerator<Uri> {
		const step = createCustomStep<Uri>({
			show: async (_step: CustomStep<Uri>) => {
				const uris = await window.showOpenDialog({
					canSelectFiles: false,
					canSelectFolders: true,
					canSelectMany: false,
					defaultUri: options.pickedUri ?? state.uri ?? context.defaultUri,
					openLabel: options.label,
					title: options.title,
				});

				if (uris == null || uris.length === 0) return Directive.Back;

				return uris[0];
			},
		});

		const value: StepSelection<typeof step> = yield step;
		if (!canStepContinue(step, state, value)) return StepResultBreak;

		return value;
	}

	private *confirmStep(
		state: StepState<State<Repository>>,
		context: Context,
	): StepResultGenerator<[ConfirmationChoice, Flags[]]> {
		/**
		 * Here are the rules for creating the recommended path for the new worktree:
		 *
		 * If the user picks a folder outside the repo, it will be `<chosen-path>/<repo>.worktrees/<?branch>`
		 * If the user picks the repo folder, it will be `<repo>/../<repo>.worktrees/<?branch>`
		 * If the user picks a folder inside the repo, it will be `<repo>/../<repo>.worktrees/<?branch>`
		 */

		let createDirectlyInFolder = false;
		if (context.pickedSpecificFolder != null) {
			createDirectlyInFolder = true;
		}

		let pickedUri = context.pickedSpecificFolder ?? context.pickedRootFolder ?? state.uri;

		let recommendedRootUri;

		const repoUri = state.repo.commonUri ?? state.repo.uri;
		const trailer = `${basename(repoUri.path)}.worktrees`;

		if (context.pickedRootFolder != null) {
			recommendedRootUri = context.pickedRootFolder;
		} else if (repoUri.toString() !== pickedUri.toString()) {
			if (isDescendant(pickedUri, repoUri)) {
				recommendedRootUri = Uri.joinPath(repoUri, '..', trailer);
			} else if (basename(pickedUri.path) === trailer) {
				pickedUri = Uri.joinPath(pickedUri, '..');
				recommendedRootUri = pickedUri;
			} else {
				recommendedRootUri = Uri.joinPath(pickedUri, trailer);
			}
		} else {
			recommendedRootUri = Uri.joinPath(repoUri, '..', trailer);
			// Don't allow creating directly into the main worktree folder
			createDirectlyInFolder = false;
		}

		const pickedFriendlyPath = truncateLeft(getWorkspaceFriendlyPath(pickedUri), 60);
		const branchName = state.reference != null ? getReferenceNameWithoutRemote(state.reference) : undefined;

		const recommendedFriendlyPath = `<root>/${truncateLeft(branchName?.replace(/\\/g, '/') ?? '', 65)}`;
		const recommendedNewBranchFriendlyPath = `<root>/${state.createBranch || '<new-branch-name>'}`;

		const isBranch = isBranchReference(state.reference);
		const isRemoteBranch = isBranchReference(state.reference) && state.reference?.remote;

		type StepType = FlagsQuickPickItem<Flags, ConfirmationChoice>;
		const defaultOption = createFlagsQuickPickItem<Flags, Uri>(
			state.flags,
			state.createBranch ? ['-b'] : [],
			{
				label: isRemoteBranch
					? 'Create Worktree from New Local Branch'
					: isBranch
						? state.createBranch
							? 'Create Worktree from New Branch'
							: 'Create Worktree from Branch'
						: context.title,
				description: state.createBranch
					? state.createBranch
					: getReferenceLabel(state.reference, { icon: false, label: false }),
				detail: `Will create worktree in $(folder) ${
					state.createBranch ? recommendedNewBranchFriendlyPath : recommendedFriendlyPath
				}`,
			},
			recommendedRootUri,
		);

		const confirmations: StepType[] = [];
		if (!createDirectlyInFolder) {
			if (state.worktreeDefaultOpen) {
				return [defaultOption.context, defaultOption.item];
			}

			confirmations.push(defaultOption);
		} else {
			if (!state.createBranch) {
				confirmations.push(
					createFlagsQuickPickItem<Flags, Uri>(
						state.flags,
						['--direct'],
						{
							label: isRemoteBranch
								? 'Create Worktree from Local Branch'
								: isBranch
									? 'Create Worktree from Branch'
									: context.title,
							description: isBranch
								? getReferenceLabel(state.reference, { icon: false, label: false })
								: '',
							detail: `Will create worktree directly in $(folder) ${truncateLeft(
								pickedFriendlyPath,
								60,
							)}`,
						},
						pickedUri,
					),
				);
			}

			confirmations.push(
				createFlagsQuickPickItem<Flags, Uri>(
					state.flags,
					['-b', '--direct'],
					{
						label: isRemoteBranch
							? 'Create Worktree from New Local Branch'
							: 'Create Worktree from New Branch',
						description: state.createBranch,
						detail: `Will create worktree directly in $(folder) ${truncateLeft(pickedFriendlyPath, 60)}`,
					},
					pickedUri,
				),
			);
		}

		if (!createDirectlyInFolder) {
			confirmations.push(
				createQuickPickSeparator('Change Location'),
				createFlagsQuickPickItem<Flags, ConfirmationChoice>(
					[],
					[],
					{
						label: 'Change Root Folder...',
						description: `$(folder) ${truncateLeft(
							context.pickedRootFolder ? pickedFriendlyPath : `${pickedFriendlyPath}/${trailer}`,
							65,
						)}`,
						picked: false,
					},
					'changeRoot',
				),
			);
		}

		confirmations.push(
			createFlagsQuickPickItem<Flags, ConfirmationChoice>(
				[],
				[],
				{
					label: 'Choose Specific Folder...',
					description: 'Create directly in a folder you choose',
					picked: false,
				},
				'chooseFolder',
			),
		);

		const step = createConfirmStep(
			appendReposToTitle(
				`Confirm ${context.title} \u2022 ${
					state.createBranch ||
					getReferenceLabel(state.reference, {
						icon: false,
						label: false,
					})
				}`,
				state,
				context,
			),
			confirmations,
			context,
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection)
			? [selection[0].context, selection[0].item]
			: StepResultBreak;
	}
}
