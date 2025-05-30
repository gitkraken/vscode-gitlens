import type { MessageItem } from 'vscode';
import { QuickInputButtons, Uri, window, workspace } from 'vscode';
import type { Config } from '../../config';
import type { Container } from '../../container';
import { PlusFeatures } from '../../features';
import { convertLocationToOpenFlags, convertOpenFlagsToLocation, reveal } from '../../git/actions/worktree';
import {
	ApplyPatchCommitError,
	ApplyPatchCommitErrorReason,
	WorktreeCreateError,
	WorktreeCreateErrorReason,
	WorktreeDeleteError,
	WorktreeDeleteErrorReason,
} from '../../git/errors';
import { uncommitted, uncommittedStaged } from '../../git/models/constants';
import type { GitReference } from '../../git/models/reference';
import {
	getNameWithoutRemote,
	getReferenceLabel,
	isBranchReference,
	isRevisionReference,
	isSha,
} from '../../git/models/reference';
import type { Repository } from '../../git/models/repository';
import { GitWorktree } from '../../git/models/worktree';
import { showGenericErrorMessage } from '../../messages';
import type { QuickPickItemOfT } from '../../quickpicks/items/common';
import { createQuickPickSeparator } from '../../quickpicks/items/common';
import { Directive } from '../../quickpicks/items/directive';
import type { FlagsQuickPickItem } from '../../quickpicks/items/flags';
import { createFlagsQuickPickItem } from '../../quickpicks/items/flags';
import { configuration } from '../../system/configuration';
import { basename, isDescendant } from '../../system/path';
import type { Deferred } from '../../system/promise';
import { pluralize, truncateLeft } from '../../system/string';
import { openWorkspace, revealInFileExplorer } from '../../system/utils';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase';
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
	canPickStepContinue,
	canStepContinue,
	createConfirmStep,
	createCustomStep,
	createPickStep,
	endSteps,
	QuickCommand,
	StepResultBreak,
} from '../quickCommand';
import {
	appendReposToTitle,
	ensureAccessStep,
	inputBranchNameStep,
	pickBranchOrTagStep,
	pickRepositoryStep,
	pickWorktreesStep,
	pickWorktreeStep,
} from '../quickCommand.steps';

interface Context {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	defaultUri?: Uri;
	pickedRootFolder?: Uri;
	pickedSpecificFolder?: Uri;
	showTags: boolean;
	title: string;
	worktrees?: GitWorktree[];
}

type CreateConfirmationChoice = Uri | 'changeRoot' | 'chooseFolder';
type CreateFlags = '--force' | '-b' | '--detach' | '--direct';

interface CreateState {
	subcommand: 'create';
	repo: string | Repository;
	uri: Uri;
	reference?: GitReference;
	addRemote?: { name: string; url: string };
	createBranch?: string;
	flags: CreateFlags[];

	result?: Deferred<GitWorktree | undefined>;
	reveal?: boolean;

	overrides?: {
		title?: string;
	};
}

type DeleteFlags = '--force';

interface DeleteState {
	subcommand: 'delete';
	repo: string | Repository;
	uris: Uri[];
	flags: DeleteFlags[];

	overrides?: {
		title?: string;
	};
}

type OpenFlags = '--add-to-workspace' | '--new-window' | '--reveal-explorer';

interface OpenState {
	subcommand: 'open';
	repo: string | Repository;
	worktree: GitWorktree;
	flags: OpenFlags[];

	openOnly?: boolean;
	overrides?: {
		disallowBack?: boolean;
		title?: string;

		confirmation?: {
			title?: string;
			placeholder?: string;
		};
	};
}

interface CopyChangesState {
	subcommand: 'copy-changes';
	repo: string | Repository;
	worktree: GitWorktree;
	changes:
		| { baseSha?: string; contents?: string; type: 'index' | 'working-tree' }
		| { baseSha: string; contents: string; type?: 'index' | 'working-tree' };

	overrides?: {
		title?: string;
	};
}

type State = CreateState | DeleteState | OpenState | CopyChangesState;
type WorktreeStepState<T extends State> = SomeNonNullable<StepState<T>, 'subcommand'>;
type CreateStepState<T extends CreateState = CreateState> = WorktreeStepState<ExcludeSome<T, 'repo', string>>;
type DeleteStepState<T extends DeleteState = DeleteState> = WorktreeStepState<ExcludeSome<T, 'repo', string>>;
type OpenStepState<T extends OpenState = OpenState> = WorktreeStepState<ExcludeSome<T, 'repo', string>>;
type CopyChangesStepState<T extends CopyChangesState = CopyChangesState> = WorktreeStepState<
	ExcludeSome<T, 'repo', string>
>;

function assertStateStepRepository(
	state: PartialStepState<State>,
): asserts state is PartialStepState<State> & { repo: Repository } {
	if (state.repo != null && typeof state.repo !== 'string') return;

	debugger;
	throw new Error('Missing repository');
}

const subcommandToTitleMap = new Map<State['subcommand'], string>([
	['create', 'Create'],
	['delete', 'Delete'],
	['open', 'Open'],
	['copy-changes', 'Copy Changes to'],
]);
function getTitle(title: string, subcommand: State['subcommand'] | undefined) {
	return subcommand == null ? title : `${subcommandToTitleMap.get(subcommand)} ${title}`;
}

export interface WorktreeGitCommandArgs {
	readonly command: 'worktree';
	confirm?: boolean;
	state?: Partial<State>;
}

export class WorktreeGitCommand extends QuickCommand<State> {
	private subcommand: State['subcommand'] | undefined;

	constructor(container: Container, args?: WorktreeGitCommandArgs) {
		super(container, 'worktree', 'worktree', 'Worktree', {
			description: 'open, create, or delete worktrees',
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
					if (args.state.worktree != null) {
						counter++;
					}

					break;
				case 'copy-changes':
					if (args.state.worktree != null) {
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

	private _canSkipConfirmOverride: boolean | undefined;
	override get canSkipConfirm(): boolean {
		return this._canSkipConfirmOverride ?? this.subcommand === 'open';
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
			context.title = state.overrides?.title ?? this.title;

			if (state.counter < 1 || state.subcommand == null) {
				this.subcommand = undefined;

				const result = yield* this.pickSubcommandStep(state);
				// Always break on the first step (so we will go back)
				if (result === StepResultBreak) break;

				state.subcommand = result;
			}

			this.subcommand = state.subcommand;
			context.title =
				state.overrides?.title ??
				getTitle(state.subcommand === 'delete' ? 'Worktrees' : this.title, state.subcommand);

			if (state.counter < 2 || state.repo == null || typeof state.repo === 'string') {
				skippedStepTwo = false;
				if (context.repos.length === 1) {
					skippedStepTwo = true;
					if (state.repo == null) {
						state.counter++;
					}

					state.repo = context.repos[0];
				} else {
					const result = yield* pickRepositoryStep(state, context);
					if (result === StepResultBreak) continue;

					state.repo = result;
				}
			}

			if (state.subcommand !== 'copy-changes') {
				// Ensure we use the "main" repository if we are in a worktree already
				state.repo = (await state.repo.getCommonRepository()) ?? state.repo;
			}
			assertStateStepRepository(state);

			const result = yield* ensureAccessStep(state, context, PlusFeatures.Worktrees);
			if (result === StepResultBreak) break;

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
				case 'copy-changes': {
					yield* this.copyChangesCommandSteps(state as CopyChangesStepState, context);
					break;
				}
				default:
					endSteps(state);
					break;
			}

			// If we skipped the previous step, make sure we back up past it
			if (skippedStepTwo) {
				state.counter--;
			}
		}

		return state.counter < 0 ? StepResultBreak : undefined;
	}

	private *pickSubcommandStep(state: PartialStepState<State>): StepResultGenerator<State['subcommand']> {
		const step = createPickStep<QuickPickItemOfT<State['subcommand']>>({
			title: this.title,
			placeholder: `Choose a ${this.label} command`,
			items: [
				{
					label: 'open',
					description: 'opens the specified worktree',
					picked: state.subcommand === 'open',
					item: 'open',
				},
				{
					label: 'create',
					description: 'creates a new worktree',
					picked: state.subcommand === 'create',
					item: 'create',
				},
				{
					label: 'delete',
					description: 'deletes the specified worktrees',
					picked: state.subcommand === 'delete',
					item: 'delete',
				},
			],
			buttons: [QuickInputButtons.Back],
		});
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}

	private async *createCommandSteps(state: CreateStepState, context: Context): AsyncStepResultGenerator<void> {
		if (context.defaultUri == null) {
			context.defaultUri = await state.repo.getWorktreesDefaultUri();
		}

		if (state.flags == null) {
			state.flags = [];
		}

		context.pickedRootFolder = undefined;
		context.pickedSpecificFolder = undefined;

		// Don't allow skipping the confirm step
		state.confirm = true;
		this._canSkipConfirmOverride = undefined;

		while (this.canStepsContinue(state)) {
			if (state.counter < 3 || state.reference == null) {
				const result = yield* pickBranchOrTagStep(state, context, {
					placeholder: context =>
						`Choose a branch${context.showTags ? ' or tag' : ''} to create the new worktree for`,
					picked: state.reference?.ref ?? (await state.repo.getBranch())?.ref,
					titleContext: ' for',
					value: isRevisionReference(state.reference) ? state.reference.ref : undefined,
				});
				// Always break on the first step (so we will go back)
				if (result === StepResultBreak) break;

				state.reference = result;
			}

			if (state.uri == null) {
				state.uri = context.defaultUri!;
			}

			if (this.confirm(state.confirm)) {
				const result = yield* this.createCommandConfirmStep(state, context);
				if (result === StepResultBreak) continue;

				if (typeof result[0] === 'string') {
					switch (result[0]) {
						case 'changeRoot': {
							const result = yield* this.createCommandChoosePathStep(state, context, {
								title: `Choose a Different Root Folder for this Worktree`,
								label: 'Choose Root Folder',
								pickedUri: context.pickedRootFolder,
								defaultUri: context.pickedRootFolder ?? context.defaultUri,
							});
							if (result === StepResultBreak) continue;

							state.uri = result;
							// Keep track of the actual uri they picked, because we will modify it in later steps
							context.pickedRootFolder = state.uri;
							context.pickedSpecificFolder = undefined;
							continue;
						}
						case 'chooseFolder': {
							const result = yield* this.createCommandChoosePathStep(state, context, {
								title: `Choose a Specific Folder for this Worktree`,
								label: 'Choose Worktree Folder',
								pickedUri: context.pickedRootFolder,
								defaultUri: context.pickedSpecificFolder ?? context.defaultUri,
							});
							if (result === StepResultBreak) continue;

							state.uri = result;
							// Keep track of the actual uri they picked, because we will modify it in later steps
							context.pickedRootFolder = undefined;
							context.pickedSpecificFolder = state.uri;
							continue;
						}
					}
				}

				[state.uri, state.flags] = result;
			}

			// Reset any confirmation overrides
			state.confirm = true;
			this._canSkipConfirmOverride = undefined;

			const isRemoteBranch = state.reference?.refType === 'branch' && state.reference?.remote;
			if (isRemoteBranch && !state.flags.includes('-b')) {
				state.flags.push('-b');

				state.createBranch = getNameWithoutRemote(state.reference);
				const branch = await state.repo.getBranch(state.createBranch);
				if (branch != null) {
					state.createBranch = state.reference.name;
				}
			}

			if (state.flags.includes('-b')) {
				let createBranchOverride: string | undefined;
				if (state.createBranch != null) {
					let valid = await this.container.git.validateBranchOrTagName(state.repo.path, state.createBranch);
					if (valid) {
						const alreadyExists = await state.repo.getBranch(state.createBranch);
						valid = alreadyExists == null;
					}

					if (!valid) {
						createBranchOverride = state.createBranch;
						state.createBranch = undefined;
					}
				}

				if (state.createBranch == null) {
					const result = yield* inputBranchNameStep(state, context, {
						titleContext: ` and New Branch from ${getReferenceLabel(state.reference, {
							capitalize: true,
							icon: false,
							label: state.reference.refType !== 'branch',
						})}`,
						value: createBranchOverride ?? state.createBranch ?? getNameWithoutRemote(state.reference),
					});
					if (result === StepResultBreak) {
						// Clear the flags, since we can backup after the confirm step below (which is non-standard)
						state.flags = [];
						continue;
					}

					state.createBranch = result;
				}
			}

			const uri = state.flags.includes('--direct')
				? state.uri
				: Uri.joinPath(
						state.uri,
						...(state.createBranch ?? state.reference.name).replace(/\\/g, '/').split('/'),
				  );

			let worktree: GitWorktree | undefined;
			try {
				if (state.addRemote != null) {
					await state.repo.addRemote(state.addRemote.name, state.addRemote.url, { fetch: true });
				}

				worktree = await state.repo.createWorktree(uri, {
					commitish: state.reference?.name,
					createBranch: state.flags.includes('-b') ? state.createBranch : undefined,
					detach: state.flags.includes('--detach'),
					force: state.flags.includes('--force'),
				});
				state.result?.fulfill(worktree);
			} catch (ex) {
				if (
					WorktreeCreateError.is(ex, WorktreeCreateErrorReason.AlreadyCheckedOut) &&
					!state.flags.includes('--force')
				) {
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
						continue;
					}

					if (result === force) {
						state.flags.push('--force');
						this._canSkipConfirmOverride = true;
						state.confirm = false;
						continue;
					}
				} else if (WorktreeCreateError.is(ex, WorktreeCreateErrorReason.AlreadyExists)) {
					const confirm: MessageItem = { title: 'OK' };
					const openFolder: MessageItem = { title: 'Open Folder' };
					void window
						.showErrorMessage(
							`Unable to create a new worktree in '${GitWorktree.getFriendlyPath(
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
					void showGenericErrorMessage(
						`Unable to create a new worktree in '${GitWorktree.getFriendlyPath(uri)}.`,
					);
				}
			}

			endSteps(state);
			if (worktree == null) break;

			if (state.reveal !== false) {
				setTimeout(() => {
					if (this.container.worktreesView.visible) {
						void reveal(worktree, { select: true, focus: false });
					}
				}, 100);
			}

			type OpenAction = Config['worktrees']['openAfterCreate'];
			const action: OpenAction = configuration.get('worktrees.openAfterCreate');
			if (action !== 'never') {
				let flags: OpenFlags[];
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

				yield* this.openCommandSteps(
					{
						subcommand: 'open',
						repo: state.repo,
						worktree: worktree,
						flags: flags,
						counter: 3,
						confirm: action === 'prompt',
						openOnly: true,
						overrides: { disallowBack: true },
					} satisfies OpenStepState,
					context,
				);
			}
		}
	}

	private *createCommandChoosePathStep(
		state: CreateStepState,
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

	private *createCommandConfirmStep(
		state: CreateStepState,
		context: Context,
	): StepResultGenerator<[CreateConfirmationChoice, CreateFlags[]]> {
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

		const pickedUri = context.pickedSpecificFolder ?? context.pickedRootFolder ?? state.uri;
		const pickedFriendlyPath = truncateLeft(GitWorktree.getFriendlyPath(pickedUri), 60);

		let recommendedRootUri;

		const repoUri = state.repo.uri;
		const trailer = `${basename(repoUri.path)}.worktrees`;

		if (repoUri.toString() !== pickedUri.toString()) {
			if (isDescendant(pickedUri, repoUri)) {
				recommendedRootUri = Uri.joinPath(repoUri, '..', trailer);
			} else if (basename(pickedUri.path) === trailer) {
				recommendedRootUri = pickedUri;
			} else {
				recommendedRootUri = Uri.joinPath(pickedUri, trailer);
			}
		} else {
			recommendedRootUri = Uri.joinPath(repoUri, '..', trailer);
			// Don't allow creating directly into the main worktree folder
			createDirectlyInFolder = false;
		}

		const branchName = state.reference != null ? getNameWithoutRemote(state.reference) : undefined;

		const recommendedFriendlyPath = `<root>/${truncateLeft(
			`${trailer}/${branchName?.replace(/\\/g, '/') ?? ''}`,
			65,
		)}`;
		const recommendedNewBranchFriendlyPath = `<root>/${trailer}/${state.createBranch || '<new-branch-name>'}`;

		const isBranch = isBranchReference(state.reference);
		const isRemoteBranch = isBranchReference(state.reference) && state.reference?.remote;

		type StepType = FlagsQuickPickItem<CreateFlags, CreateConfirmationChoice>;

		const confirmations: StepType[] = [];
		if (!createDirectlyInFolder) {
			if (!state.createBranch) {
				confirmations.push(
					createFlagsQuickPickItem<CreateFlags, Uri>(
						state.flags,
						[],
						{
							label: isRemoteBranch
								? 'Create Worktree for Local Branch'
								: isBranch
								  ? 'Create Worktree for Branch'
								  : context.title,
							description: '',
							detail: `Will create worktree in $(folder) ${recommendedFriendlyPath}`,
						},
						recommendedRootUri,
					),
				);
			}

			confirmations.push(
				createFlagsQuickPickItem<CreateFlags, Uri>(
					state.flags,
					['-b'],
					{
						label: isRemoteBranch
							? 'Create Worktree for New Local Branch'
							: 'Create Worktree for New Branch',
						description: '',
						detail: `Will create worktree in $(folder) ${recommendedNewBranchFriendlyPath}`,
					},
					recommendedRootUri,
				),
			);
		} else {
			if (!state.createBranch) {
				confirmations.push(
					createFlagsQuickPickItem<CreateFlags, Uri>(
						state.flags,
						['--direct'],
						{
							label: isRemoteBranch
								? 'Create Worktree for Local Branch'
								: isBranch
								  ? 'Create Worktree for Branch'
								  : context.title,
							description: '',
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
				createFlagsQuickPickItem<CreateFlags, Uri>(
					state.flags,
					['-b', '--direct'],
					{
						label: isRemoteBranch
							? 'Create Worktree for New Local Branch'
							: 'Create Worktree for New Branch',
						description: '',
						detail: `Will create worktree directly in $(folder) ${truncateLeft(pickedFriendlyPath, 60)}`,
					},
					pickedUri,
				),
			);
		}

		if (!createDirectlyInFolder) {
			confirmations.push(
				createQuickPickSeparator(),
				createFlagsQuickPickItem<CreateFlags, CreateConfirmationChoice>(
					[],
					[],
					{
						label: 'Change Root Folder...',
						description: `$(folder) ${truncateLeft(pickedFriendlyPath, 65)}`,
						picked: false,
					},
					'changeRoot',
				),
			);
		}

		confirmations.push(
			createFlagsQuickPickItem<CreateFlags, CreateConfirmationChoice>(
				[],
				[],
				{
					label: 'Choose a Specific Folder...',
					description: '',
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

	private async *deleteCommandSteps(state: DeleteStepState, context: Context): StepGenerator {
		context.worktrees = await state.repo.getWorktrees();

		if (state.flags == null) {
			state.flags = [];
		}

		while (this.canStepsContinue(state)) {
			if (state.counter < 3 || state.uris == null || state.uris.length === 0) {
				context.title = getTitle('Worktrees', state.subcommand);

				const result = yield* pickWorktreesStep(state, context, {
					filter: wt => !wt.main || !wt.opened, // Can't delete the main or opened worktree
					includeStatus: true,
					picked: state.uris?.map(uri => uri.toString()),
					placeholder: 'Choose worktrees to delete',
				});
				// Always break on the first step (so we will go back)
				if (result === StepResultBreak) break;

				state.uris = result.map(w => w.uri);
			}

			context.title = getTitle(pluralize('Worktree', state.uris.length, { only: true }), state.subcommand);

			const result = yield* this.deleteCommandConfirmStep(state, context);
			if (result === StepResultBreak) continue;

			state.flags = result;

			endSteps(state);

			for (const uri of state.uris) {
				let retry = false;
				do {
					retry = false;
					const force = state.flags.includes('--force');

					try {
						if (force) {
							const worktree = context.worktrees.find(wt => wt.uri.toString() === uri.toString());
							let status;
							try {
								status = await worktree?.getStatus();
							} catch {}

							if (status?.hasChanges ?? false) {
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

						await state.repo.deleteWorktree(uri, { force: force });
					} catch (ex) {
						if (WorktreeDeleteError.is(ex)) {
							if (ex.reason === WorktreeDeleteErrorReason.MainWorkingTree) {
								void window.showErrorMessage('Unable to delete the main worktree');
							} else if (!force) {
								const confirm: MessageItem = { title: 'Force Delete' };
								const cancel: MessageItem = { title: 'Cancel', isCloseAffordance: true };
								const result = await window.showErrorMessage(
									ex.reason === WorktreeDeleteErrorReason.HasChanges
										? `Unable to delete worktree because there are UNCOMMITTED changes in '${uri.fsPath}'.\n\nForcibly deleting it will cause those changes to be FOREVER LOST.\nThis is IRREVERSIBLE!\n\nWould you like to forcibly delete it?`
										: `Unable to delete worktree in '${uri.fsPath}'.\n\nWould you like to try to forcibly delete it?`,
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
							void showGenericErrorMessage(`Unable to delete worktree in '${uri.fsPath}.`);
						}
					}
				} while (retry);
			}
		}
	}

	private *deleteCommandConfirmStep(state: DeleteStepState, context: Context): StepResultGenerator<DeleteFlags[]> {
		const step: QuickPickStep<FlagsQuickPickItem<DeleteFlags>> = createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			[
				createFlagsQuickPickItem<DeleteFlags>(state.flags, [], {
					label: context.title,
					detail: `Will delete ${pluralize('worktree', state.uris.length, {
						only: state.uris.length === 1,
					})}${state.uris.length === 1 ? ` in $(folder) ${GitWorktree.getFriendlyPath(state.uris[0])}` : ''}`,
				}),
				createFlagsQuickPickItem<DeleteFlags>(state.flags, ['--force'], {
					label: `Force ${context.title}`,
					description: 'including ANY UNCOMMITTED changes',
					detail: `Will forcibly delete ${pluralize('worktree', state.uris.length, {
						only: state.uris.length === 1,
					})} ${
						state.uris.length === 1 ? ` in $(folder) ${GitWorktree.getFriendlyPath(state.uris[0])}` : ''
					}`,
				}),
			],
			context,
		);

		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}

	private async *openCommandSteps(state: OpenStepState, context: Context): StepGenerator {
		if (state.flags == null) {
			state.flags = [];
		}

		// Allow skipping the confirm step
		this._canSkipConfirmOverride = true;

		while (this.canStepsContinue(state)) {
			if (state.counter < 3 || state.worktree == null) {
				context.title = getTitle('Worktree', state.subcommand);
				context.worktrees ??= await state.repo.getWorktrees();

				const result = yield* pickWorktreeStep(state, context, {
					includeStatus: true,
					picked: state.worktree?.uri?.toString(),
					placeholder: 'Choose worktree to open',
				});
				// Always break on the first step (so we will go back)
				if (result === StepResultBreak) break;

				state.worktree = result;
			}

			context.title = getTitle(`Worktree \u2022 ${state.worktree.name}`, state.subcommand);

			if (this.confirm(state.confirm)) {
				const result = yield* this.openCommandConfirmStep(state, context);
				if (result === StepResultBreak) continue;

				state.flags = result;
			}

			endSteps(state);

			if (state.flags.includes('--reveal-explorer')) {
				void revealInFileExplorer(state.worktree.uri);
			} else {
				let name;

				const repo = (await state.repo.getCommonRepository()) ?? state.repo;
				if (repo.name !== state.worktree.name) {
					name = `${repo.name}: ${state.worktree.name}`;
				} else {
					name = state.worktree.name;
				}

				openWorkspace(state.worktree.uri, { location: convertOpenFlagsToLocation(state.flags), name: name });
			}
		}
	}

	private *openCommandConfirmStep(state: OpenStepState, context: Context): StepResultGenerator<OpenFlags[]> {
		type StepType = FlagsQuickPickItem<OpenFlags>;

		const confirmations: StepType[] = [
			createFlagsQuickPickItem<OpenFlags>(state.flags, [], {
				label: 'Open Worktree',
				detail: 'Will open the worktree in the current window',
			}),
			createFlagsQuickPickItem<OpenFlags>(state.flags, ['--new-window'], {
				label: `Open Worktree in a New Window`,
				detail: 'Will open the worktree in a new window',
			}),
			createFlagsQuickPickItem<OpenFlags>(state.flags, ['--add-to-workspace'], {
				label: `Add Worktree to Workspace`,
				detail: 'Will add the worktree into the current workspace',
			}),
		];

		if (!state.openOnly) {
			confirmations.push(
				createQuickPickSeparator(),
				createFlagsQuickPickItem<OpenFlags>(state.flags, ['--reveal-explorer'], {
					label: `Reveal in File Explorer`,
					description: `$(folder) ${truncateLeft(GitWorktree.getFriendlyPath(state.worktree.uri), 40)}`,
					detail: 'Will open the worktree in the File Explorer',
				}),
			);
		}

		const step = createConfirmStep(
			appendReposToTitle(state.overrides?.confirmation?.title ?? `Confirm ${context.title}`, state, context),
			confirmations,
			context,
			undefined,
			{
				disallowBack: state.overrides?.disallowBack,
				placeholder: state.overrides?.confirmation?.placeholder ?? 'Confirm Open Worktree',
			},
		);

		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}

	private async *copyChangesCommandSteps(state: CopyChangesStepState, context: Context): StepGenerator {
		while (this.canStepsContinue(state)) {
			context.title = state?.overrides?.title ?? getTitle('Worktree', state.subcommand);

			if (state.counter < 3 || state.worktree == null) {
				context.worktrees ??= await state.repo.getWorktrees();

				let placeholder;
				switch (state.changes.type) {
					case 'index':
						placeholder = 'Choose a worktree to copy your staged changes to';
						break;
					case 'working-tree':
						placeholder = 'Choose a worktree to copy your working changes to';
						break;
					default:
						placeholder = 'Choose a worktree to copy changes to';
						break;
				}

				const result = yield* pickWorktreeStep(state, context, {
					excludeOpened: true,
					includeStatus: true,
					picked: state.worktree?.uri?.toString(),
					placeholder: placeholder,
				});
				// Always break on the first step (so we will go back)
				if (result === StepResultBreak) break;

				state.worktree = result;
			}

			if (!state.changes.contents || !state.changes.baseSha) {
				const diff = await this.container.git.getDiff(
					state.repo.uri,
					state.changes.type === 'index' ? uncommittedStaged : uncommitted,
					'HEAD',
				);
				if (!diff?.contents) {
					void window.showErrorMessage(`No changes to copy`);

					endSteps(state);
					break;
				}

				state.changes.contents = diff.contents;
				state.changes.baseSha = diff.from;
			}

			if (!isSha(state.changes.baseSha)) {
				const commit = await this.container.git.getCommit(state.repo.uri, state.changes.baseSha);
				if (commit != null) {
					state.changes.baseSha = commit.sha;
				}
			}

			if (this.confirm(state.confirm)) {
				const result = yield* this.copyChangesCommandConfirmStep(state, context);
				if (result === StepResultBreak) continue;
			}

			endSteps(state);

			try {
				const commit = await this.container.git.createUnreachableCommitForPatch(
					state.worktree.uri,
					state.changes.contents,
					state.changes.baseSha,
					'Copied Changes',
				);
				if (commit == null) return;

				await this.container.git.applyUnreachableCommitForPatch(state.worktree.uri, commit.sha, {
					stash: false,
				});
				void window.showInformationMessage(`Changes copied successfully`);
			} catch (ex) {
				if (ex instanceof ApplyPatchCommitError) {
					if (ex.reason === ApplyPatchCommitErrorReason.AppliedWithConflicts) {
						void window.showWarningMessage('Changes copied with conflicts');
					} else if (ex.reason === ApplyPatchCommitErrorReason.ApplyAbortedWouldOverwrite) {
						void window.showErrorMessage(
							'Unable to copy changes as some local changes would be overwritten',
						);
						return;
					} else {
						void window.showErrorMessage(`Unable to copy changes: ${ex.message}`);
						return;
					}
				} else {
					void window.showErrorMessage(`Unable to copy changes: ${ex.message}`);
					return;
				}
			}

			yield* this.openCommandSteps(
				{
					subcommand: 'open',
					repo: state.repo,
					worktree: state.worktree,
					flags: [],
					counter: 3,
					confirm: true,
					openOnly: true,
					overrides: { disallowBack: true },
				} satisfies OpenStepState,
				context,
			);
		}
	}

	private async *copyChangesCommandConfirmStep(
		state: CopyChangesStepState,
		context: Context,
	): AsyncStepResultGenerator<void> {
		const files = await this.container.git.getDiffFiles(state.repo.uri, state.changes.contents!);
		const count = files?.files.length ?? 0;

		const confirmations = [];
		switch (state.changes.type) {
			case 'index':
				confirmations.push({
					label: 'Copy Staged Changes to Worktree',
					detail: `Will copy the staged changes${
						count > 0 ? ` (${pluralize('file', count)})` : ''
					} to worktree '${state.worktree.name}'`,
				});
				break;
			case 'working-tree':
				confirmations.push({
					label: 'Copy Working Changes to Worktree',
					detail: `Will copy the working changes${
						count > 0 ? ` (${pluralize('file', count)})` : ''
					} to worktree '${state.worktree.name}'`,
				});
				break;

			default:
				confirmations.push(
					createFlagsQuickPickItem([], [], {
						label: 'Copy Changes to Worktree',
						detail: `Will copy the changes${
							count > 0 ? ` (${pluralize('file', count)})` : ''
						} to worktree '${state.worktree.name}'`,
					}),
				);
				break;
		}

		const step = createConfirmStep(
			`Confirm ${context.title} \u2022 ${state.worktree.name}`,
			confirmations,
			context,
		);

		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? undefined : StepResultBreak;
	}
}
