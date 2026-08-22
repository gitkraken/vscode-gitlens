import type { MessageItem } from 'vscode';
import { ThemeIcon, Uri, window, workspace } from 'vscode';
import { WorktreeCreateError } from '@gitlens/git/errors.js';
import type { GitReference } from '@gitlens/git/models/reference.js';
import type { GitWorktree } from '@gitlens/git/models/worktree.js';
import {
	getReferenceLabel,
	getReferenceNameWithoutRemote,
	isBranchReference,
	isRevisionReference,
} from '@gitlens/git/utils/reference.utils.js';
import { basename } from '@gitlens/utils/path.js';
import type { Deferred } from '@gitlens/utils/promise.js';
import { truncateLeft } from '@gitlens/utils/string.js';
import type { Container } from '../../../container.js';
import { convertLocationToOpenFlags, revealWorktree } from '../../../git/actions/worktree.js';
import type { GlRepository } from '../../../git/models/repository.js';
import { getWorktreeForBranch } from '../../../git/utils/-webview/worktree.utils.js';
import { showGitErrorMessage } from '../../../messages.js';
import type { StartReviewChatAction, StartWorkChatAction } from '../../../plus/chat/chatActions.js';
import { storeChatActionDeepLink } from '../../../plus/chat/chatActions.js';
import { createQuickPickSeparator } from '../../../quickpicks/items/common.js';
import type { DirectiveQuickPickItem } from '../../../quickpicks/items/directive.js';
import { createDirectiveQuickPickItem, Directive } from '../../../quickpicks/items/directive.js';
import type { FlagsQuickPickItem } from '../../../quickpicks/items/flags.js';
import { createFlagsQuickPickItem } from '../../../quickpicks/items/flags.js';
import { executeCommand } from '../../../system/-webview/command.js';
import { configuration } from '../../../system/-webview/configuration.js';
import { isDescendant } from '../../../system/-webview/path.js';
import { revealInFileExplorer } from '../../../system/-webview/vscode.js';
import { getWorkspaceFriendlyPath } from '../../../system/-webview/vscode/workspaces.js';
import type { OpenChatActionCommandArgs } from '../../openChatAction.js';
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
import { inputBranchNameStep } from '../../quick-wizard/steps/branches.js';
import { pickBranchOrTagStep } from '../../quick-wizard/steps/references.js';
import { canSkipRepositoryPick, pickRepositoryStep } from '../../quick-wizard/steps/repositories.js';
import { StepsController } from '../../quick-wizard/stepsController.js';
import { getSteps } from '../../quick-wizard/utils/quickWizard.utils.js';
import {
	appendReposToTitle,
	assertStepState,
	canPickStepContinue,
	createConfirmStep,
	refreshConfirmStepItems,
} from '../../quick-wizard/utils/steps.utils.js';
import type { WorktreeContext } from '../worktree.js';
import type { WorktreeOpenState } from './open.js';

const Steps = {
	PickRepo: 'worktree-create-pick-repo',
	EnsureAccess: 'worktree-create-ensure-access',
	PickRef: 'worktree-create-pick-ref',
	InputBranchName: 'worktree-create-input-branch-name',
	Confirm: 'worktree-create-confirm',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];
export type WorktreeCreateStepNames = StepNames;

type Context = WorktreeContext<StepNames>;

type OpenChoice = NonNullable<State['openAfterCreate']>;

/**
 * Maps the configured worktrees.openAfterCreate value onto the After Creating radio choices.
 * Legacy values, renamed to match the radios, map as: always -> currentWindow,
 * alwaysNewWindow -> newWindow, never -> none, prompt -> newWindow (its previous seed).
 * onlyWhenEmpty resolves against whether any folder is open in the current window.
 */
function getConfiguredOpenChoice(value: string, hasOpenFolders: boolean): OpenChoice {
	switch (value) {
		case 'currentWindow':
		case 'always':
			return 'currentWindow';
		case 'addToWorkspace':
			return 'addToWorkspace';
		case 'none':
		case 'never':
			return 'none';
		case 'onlyWhenEmpty':
			return hasOpenFolders ? 'newWindow' : 'currentWindow';
		default:
			return 'newWindow';
	}
}

type Flags = '--force' | '-b' | '--detach' | '--direct';
interface State<Repo = string | GlRepository> {
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
	/**
	 * Per-invocation override for the worktree's post-create open behavior:
	 *   - `'new'`     : force-open in a new window (skips the prompt)
	 *   - `'current'` : force-open in the current window (skips the prompt)
	 *   - `'none'`    : skip the open step entirely (caller handles the post-create work itself —
	 *                   e.g., CLI agent dispatch opens a terminal in the current window with `cwd`
	 *                   pointing to the worktree path, so no window switch is needed)
	 *   - undefined   : honor the user's `gitlens.worktrees.openAfterCreate` setting
	 */
	worktreeDefaultOpen?: 'new' | 'current' | 'none';

	/**
	 * Chosen via the confirm step's After Creating radio group; overrides `worktrees.openAfterCreate`
	 * for this run. Picking a radio also writes through to that setting, making it the remembered
	 * default for future runs.
	 */
	openAfterCreate?: 'newWindow' | 'currentWindow' | 'addToWorkspace' | 'none';

	// Chat action for deeplink storage
	chatAction?: StartWorkChatAction | StartReviewChatAction;
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
				const remoteBranchName = isRemoteBranch ? getReferenceNameWithoutRemote(state.reference) : undefined;
				if (
					(isRemoteBranch || isRevisionReference(state.reference) || state.worktree != null) &&
					!state.flags.includes('-b')
				) {
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

					state.uri = result[0];
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
						...(isRemoteBranch && state.createBranch !== remoteBranchName
							? { noTracking: true }
							: undefined),
					});
					state.result?.fulfill(worktree);

					// Wire the chatAction to the new worktree. Two paths:
					//   - CLI agent: dispatch inline in the current window — terminal opens here
					//     with `cwd = worktree.uri.fsPath`. No new window, no deep-link bridge.
					//   - Anything else (IDE chat, Claude extension, legacy): store the deep-link
					//     so it resumes in the new worktree window (per `worktreeDefaultOpen` /
					//     `gitlens.worktrees.openAfterCreate`).
					if (state.chatAction && worktree) {
						const chatActionWithPath = { ...state.chatAction, worktreePath: worktree.uri.fsPath };
						if (state.chatAction.agent?.kind === 'cli') {
							void executeCommand('gitlens.openChatAction', {
								chatAction: chatActionWithPath,
							} as OpenChatActionCommandArgs);
						} else {
							await storeChatActionDeepLink(this.container, chatActionWithPath, worktree.uri.fsPath);
						}
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

				// The After Creating radio choice from the confirm step is the whole answer to the open
				// question — flows that never showed the confirm (worktreeDefaultOpen short-circuits,
				// skipped confirmations) fall back to the worktrees.openAfterCreate setting
				const action = getConfiguredOpenChoice(
					configuration.get('worktrees.openAfterCreate'),
					Boolean(workspace.workspaceFolders?.length),
				);
				const openChoice: OpenChoice = state.openAfterCreate ?? action;
				const skipOpen = openChoice === 'none' || state.worktreeDefaultOpen === 'none';
				if (!skipOpen) {
					// Narrowed to a concrete location here -- `skipOpen` above excluded 'none'
					const flags: WorktreeOpenState['flags'] = convertLocationToOpenFlags(openChoice);

					yield* getSteps(
						this.container,
						{
							command: 'worktree',
							// The radio choice (or the setting) is the whole answer to the open question -- the
							// open command's own confirm must stay suppressed, and omitting it would fall back
							// to the skipConfirmations check and re-ask
							confirm: false,
							state: {
								subcommand: 'open',
								repo: state.repo,
								worktree: worktree,
								flags: flags,
								openOnly: true,
								overrides: { canGoBack: false },
								isNewWorktree: true,
								worktreeDefaultOpen:
									state.worktreeDefaultOpen === 'none' ? undefined : state.worktreeDefaultOpen,
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

	private *confirmStep(state: StepState<State<GlRepository>>, context: Context): StepResultGenerator<[Uri, Flags[]]> {
		/**
		 * Here are the rules for creating the recommended path for the new worktree:
		 *
		 * If the user picks a folder outside the repo, it will be `<chosen-path>/<repo>.worktrees/<?branch>`
		 * If the user picks the repo folder, it will be `<repo>/../<repo>.worktrees/<?branch>`
		 * If the user picks a folder inside the repo, it will be `<repo>/../<repo>.worktrees/<?branch>`
		 */
		const repoUri = state.repo.commonUri ?? state.repo.uri;
		const trailer = `${basename(repoUri.path)}.worktrees`;

		const isBranch = isBranchReference(state.reference);
		const isRemoteBranch = isBranchReference(state.reference) && state.reference?.remote;
		const branchName = state.reference != null ? getReferenceNameWithoutRemote(state.reference) : undefined;

		// Location is edited in place by the property rows below, so everything derived from it is
		// recomputed per rebuild rather than fixed at step construction
		const computeLocation = (): {
			createDirectlyInFolder: boolean;
			pickedUri: Uri;
			recommendedRootUri: Uri;
			pickedFriendlyPath: string;
			rootFriendlyPath: string;
		} => {
			let createDirectlyInFolder = context.pickedSpecificFolder != null;
			let pickedUri = context.pickedSpecificFolder ?? context.pickedRootFolder ?? state.uri;

			let recommendedRootUri;
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

			return {
				createDirectlyInFolder: createDirectlyInFolder,
				pickedUri: pickedUri,
				recommendedRootUri: recommendedRootUri,
				pickedFriendlyPath: truncateLeft(getWorkspaceFriendlyPath(pickedUri), 60),
				rootFriendlyPath: truncateLeft(getWorkspaceFriendlyPath(recommendedRootUri), 60),
			};
		};

		let location = computeLocation();

		const openChoices: { choice: OpenChoice; label: string; clause: string }[] = [
			{ choice: 'newWindow', label: 'Open in New Window', clause: ', then open it in a new window' },
			{ choice: 'currentWindow', label: 'Open in Current Window', clause: ', then switch this window to it' },
			{ choice: 'addToWorkspace', label: 'Add to Workspace', clause: ', then add it to this workspace' },
			{ choice: 'none', label: "Don't Open", clause: '' },
		];

		// After Creating selection; seeded from the worktrees.openAfterCreate setting -- which the
		// radios also write back to on selection, making the setting the remembered default
		let openChoice: OpenChoice = getConfiguredOpenChoice(
			configuration.get('worktrees.openAfterCreate'),
			Boolean(workspace.workspaceFolders?.length),
		);

		const openClause = (): string => openChoices.find(c => c.choice === openChoice)?.clause ?? '';

		type StepType = FlagsQuickPickItem<Flags, Uri>;

		// Folds the live Location and After Creating values into each mode's payload and detail -- the
		// accepted item's [uri, flags] pair is the whole contract with the create step above
		const buildItems = (): StepType[] => {
			const recommendedFriendlyPath = `<root>/${truncateLeft(branchName?.replace(/\\/g, '/') ?? '', 65)}`;
			const recommendedNewBranchFriendlyPath = `<root>/${state.createBranch || '<new-branch-name>'}`;

			const items: StepType[] = [];
			if (!location.createDirectlyInFolder) {
				items.push(
					createFlagsQuickPickItem<Flags, Uri>(
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
							}${openClause()}`,
							picked: true,
						},
						location.recommendedRootUri,
					),
				);
			} else {
				if (!state.createBranch) {
					items.push(
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
								detail: `Will create worktree directly in $(folder) ${location.pickedFriendlyPath}${openClause()}`,
								picked: true,
							},
							location.pickedUri,
						),
					);
				}

				items.push(
					createFlagsQuickPickItem<Flags, Uri>(
						state.flags,
						['-b', '--direct'],
						{
							label: isRemoteBranch
								? 'Create Worktree from New Local Branch'
								: 'Create Worktree from New Branch',
							description: state.createBranch,
							detail: `Will create worktree directly in $(folder) ${location.pickedFriendlyPath}${openClause()}`,
							picked: Boolean(state.createBranch),
						},
						location.pickedUri,
					),
				);
			}

			return items;
		};

		if (state.worktreeDefaultOpen) {
			const shortcut = buildItems();
			return [shortcut[0].context, shortcut[0].item];
		}

		let items = buildItems();

		let step: QuickPickStep<StepType | DirectiveQuickPickItem>;

		interface Rows {
			root?: DirectiveQuickPickItem;
			specific?: DirectiveQuickPickItem;
			radios?: DirectiveQuickPickItem[];
		}
		// A mutable holder rather than separate variables so each row's handler can reach its siblings
		// without forward-referencing a not-yet-declared `const` (an `eslint(no-use-before-define)` build
		// error) -- every property is populated below before `buildRows` is ever called
		const rows: Rows = {};

		/** Every row the confirm step shows, minus the separator + Cancel that `createConfirmStep` appends */
		const buildRows = (): (StepType | DirectiveQuickPickItem)[] => [
			...items,
			createQuickPickSeparator<StepType | DirectiveQuickPickItem>('Location'),
			rows.root!,
			rows.specific!,
			createQuickPickSeparator<StepType | DirectiveQuickPickItem>('After Creating'),
			...rows.radios!,
		];

		const rootDescription = (): string =>
			`$(folder) ${location.rootFriendlyPath}${
				location.createDirectlyInFolder ? ' \u00b7 not used \u2014 a specific folder is chosen' : ''
			}`;
		const specificDescription = (): string =>
			context.pickedSpecificFolder != null ? `$(folder) ${location.pickedFriendlyPath}` : '(none)';

		const refresh = (): void => {
			location = computeLocation();
			rows.root!.description = rootDescription();
			rows.specific!.description = specificDescription();
			items = buildItems();
			refreshConfirmStepItems(step, buildRows());
		};

		// Property rows: accepting one freezes the confirm while the folder dialog is active, then
		// restores it and rewrites its rows in place when a folder was selected
		const chooseFolder = async (options: { title: string; label: string; specific: boolean }): Promise<void> => {
			using _frozen = step.freeze?.();

			const uris = await window.showOpenDialog({
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false,
				defaultUri: context.pickedRootFolder ?? state.uri ?? context.defaultUri,
				openLabel: options.label,
				title: options.title,
			});
			if (uris == null || uris.length === 0) return;

			if (options.specific) {
				context.pickedRootFolder = undefined;
				context.pickedSpecificFolder = uris[0];
			} else {
				context.pickedRootFolder = uris[0];
				context.pickedSpecificFolder = undefined;
			}
			state.uri = uris[0];
			refresh();
		};

		rows.root = createDirectiveQuickPickItem(Directive.Noop, false, {
			label: 'Root Folder\u2026',
			description: rootDescription(),
			detail: 'Choose a different root folder for worktrees',
			onDidSelect: () =>
				chooseFolder({
					title: 'Choose a Different Root Folder for this Worktree',
					label: 'Choose Root Folder',
					specific: false,
				}),
		});

		rows.specific = createDirectiveQuickPickItem(Directive.Noop, false, {
			label: 'Specific Folder\u2026',
			description: specificDescription(),
			detail: 'Create directly in an exact folder instead of under the root',
			onDidSelect: () =>
				chooseFolder({
					title: 'Choose a Specific Folder for this Worktree',
					label: 'Choose Worktree Folder',
					specific: true,
				}),
		});

		// Radios pair with their choice by index — never by label, which selection state shouldn't
		// round-trip through
		rows.radios = openChoices.map(c =>
			createDirectiveQuickPickItem(Directive.Noop, false, {
				label: c.label,
				iconPath: new ThemeIcon(`gitlens-radio-${openChoice === c.choice ? 'checked' : 'unchecked'}`),
				onDidSelect: () => {
					openChoice = c.choice;
					void configuration.updateEffective('worktrees.openAfterCreate', c.choice);
					for (const [i, radio] of rows.radios!.entries()) {
						radio.iconPath = new ThemeIcon(
							`gitlens-radio-${openChoice === openChoices[i].choice ? 'checked' : 'unchecked'}`,
						);
					}
					refresh();
				},
			}),
		);

		step = createConfirmStep(
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
			buildRows(),
			context,
		);
		const selection: StepSelection<typeof step> = yield step;
		if (!canPickStepContinue(step, state, selection)) return StepResultBreak;

		state.openAfterCreate = openChoice;
		return [selection[0].context, selection[0].item];
	}
}
