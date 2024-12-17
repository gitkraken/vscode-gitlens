import { QuickInputButtons } from 'vscode';
import type { Container } from '../../container';
import { addAssociatedIssueToBranch, getNameWithoutRemote } from '../../git/models/branch.utils';
import type { IssueShape } from '../../git/models/issue';
import type { GitBranchReference, GitReference } from '../../git/models/reference';
import { getReferenceLabel, isBranchReference, isRevisionReference } from '../../git/models/reference.utils';
import { Repository } from '../../git/models/repository';
import type { GitWorktree } from '../../git/models/worktree';
import { getWorktreesByBranch } from '../../git/models/worktree.utils';
import { showGenericErrorMessage } from '../../messages';
import { getIssueOwner } from '../../plus/integrations/providers/utils';
import type { QuickPickItemOfT } from '../../quickpicks/items/common';
import { createQuickPickSeparator } from '../../quickpicks/items/common';
import type { FlagsQuickPickItem } from '../../quickpicks/items/flags';
import { createFlagsQuickPickItem } from '../../quickpicks/items/flags';
import { ensureArray } from '../../system/array';
import { Logger } from '../../system/logger';
import { pluralize } from '../../system/string';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase';
import type {
	AsyncStepResultGenerator,
	PartialStepState,
	QuickPickStep,
	StepGenerator,
	StepResultGenerator,
	StepSelection,
	StepState,
} from '../quickCommand';
import {
	canPickStepContinue,
	createConfirmStep,
	createPickStep,
	endSteps,
	QuickCommand,
	StepResultBreak,
} from '../quickCommand';
import {
	appendReposToTitle,
	inputBranchNameStep,
	pickBranchesStep,
	pickBranchOrTagStep,
	pickBranchStep,
	pickRepositoryStep,
} from '../quickCommand.steps';
import { getSteps } from '../quickWizard.utils';

interface Context {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	showTags: boolean;
	title: string;
}

type CreateFlags = '--switch' | '--worktree';

interface CreateState {
	subcommand: 'create';
	repo: string | Repository;
	reference: GitReference;
	name: string;
	flags: CreateFlags[];

	suggestNameOnly?: boolean;
	suggestRepoOnly?: boolean;
	confirmOptions?: CreateFlags[];
	associateWithIssue?: IssueShape;
}

function isCreateState(state: Partial<State> | undefined): state is Partial<CreateState> {
	return state?.subcommand === 'create';
}

type DeleteFlags = '--force' | '--remotes';

interface DeleteState {
	subcommand: 'delete';
	repo: string | Repository;
	references: GitBranchReference | GitBranchReference[];
	flags: DeleteFlags[];
}

type PruneState = Replace<DeleteState, 'subcommand', 'prune'>;

type RenameFlags = '-m';

interface RenameState {
	subcommand: 'rename';
	repo: string | Repository;
	reference: GitBranchReference;
	name: string;
	flags: RenameFlags[];
}

type State = CreateState | DeleteState | PruneState | RenameState;
type BranchStepState<T extends State> = SomeNonNullable<StepState<T>, 'subcommand'>;

type CreateStepState<T extends CreateState = CreateState> = BranchStepState<ExcludeSome<T, 'repo', string>>;
function assertStateStepCreate(state: PartialStepState<State>): asserts state is CreateStepState {
	if (state.repo instanceof Repository && state.subcommand === 'create') return;

	debugger;
	throw new Error('Missing repository');
}

type DeleteStepState<T extends DeleteState = DeleteState> = BranchStepState<ExcludeSome<T, 'repo', string>>;
function assertStateStepDelete(state: PartialStepState<State>): asserts state is DeleteStepState {
	if (state.repo instanceof Repository && state.subcommand === 'delete') return;

	debugger;
	throw new Error('Missing repository');
}

type PruneStepState<T extends PruneState = PruneState> = BranchStepState<ExcludeSome<T, 'repo', string>>;
function assertStateStepPrune(state: PartialStepState<State>): asserts state is PruneStepState {
	if (state.repo instanceof Repository && state.subcommand === 'prune') return;

	debugger;
	throw new Error('Missing repository');
}

type RenameStepState<T extends RenameState = RenameState> = BranchStepState<ExcludeSome<T, 'repo', string>>;
function assertStateStepRename(state: PartialStepState<State>): asserts state is RenameStepState {
	if (state.repo instanceof Repository && state.subcommand === 'rename') return;

	debugger;
	throw new Error('Missing repository');
}

function assertStateStepDeleteBranches(
	state: DeleteStepState | PruneStepState,
): asserts state is ExcludeSome<typeof state, 'references', GitBranchReference> {
	if (Array.isArray(state.references)) return;

	debugger;
	throw new Error('Missing branches');
}

const subcommandToTitleMap = new Map<State['subcommand'], string>([
	['create', 'Create'],
	['delete', 'Delete'],
	['prune', 'Prune'],
	['rename', 'Rename'],
]);
function getTitle(title: string, subcommand: State['subcommand'] | undefined) {
	return subcommand == null ? title : `${subcommandToTitleMap.get(subcommand)} ${title}`;
}

export interface BranchGitCommandArgs {
	readonly command: 'branch';
	confirm?: boolean;
	state?: Partial<State>;
}

export class BranchGitCommand extends QuickCommand {
	private subcommand: State['subcommand'] | undefined;

	constructor(container: Container, args?: BranchGitCommandArgs) {
		super(container, 'branch', 'branch', 'Branch', {
			description: 'create, prune, rename, or delete branches',
		});

		let counter = 0;
		if (args?.state?.subcommand != null) {
			counter++;

			switch (args?.state.subcommand) {
				case 'create':
					if (args.state.flags != null) {
						counter++;
					}

					if (args.state.reference != null) {
						counter++;
					}

					if (!args.state.suggestNameOnly && args.state.name != null) {
						counter++;
					}

					if (args.state.suggestRepoOnly && args.state.repo != null) {
						counter--;
					}

					break;
				case 'delete':
				case 'prune':
					if (
						args.state.references != null &&
						(!Array.isArray(args.state.references) || args.state.references.length !== 0)
					) {
						counter++;
					}

					break;
				case 'rename':
					if (args.state.reference != null) {
						counter++;
					}

					if (args.state.name != null) {
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
		return this.subcommand === 'delete' || this.subcommand === 'prune' || this.subcommand === 'rename'
			? false
			: super.canSkipConfirm;
	}

	override get skipConfirmKey() {
		return `${this.key}${this.subcommand == null ? '' : `-${this.subcommand}`}:${this.pickedVia}`;
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			associatedView: this.container.views.branches,
			repos: this.container.git.openRepositories,
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
				if (result === StepResultBreak) break;

				state.subcommand = result;
			}

			this.subcommand = state.subcommand;

			context.title = getTitle(
				state.subcommand === 'delete' || state.subcommand === 'prune' ? 'Branches' : this.title,
				state.subcommand,
			);

			if (
				state.counter < 2 ||
				state.repo == null ||
				typeof state.repo === 'string' ||
				(isCreateState(state) && state.suggestRepoOnly)
			) {
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

			switch (state.subcommand) {
				case 'create':
					assertStateStepCreate(state);
					yield* this.createCommandSteps(state, context);
					// Clear any chosen name, since we are exiting this subcommand
					state.name = undefined!;
					break;
				case 'delete':
					assertStateStepDelete(state);
					yield* this.deleteCommandSteps(state, context);
					break;
				case 'prune':
					assertStateStepPrune(state);
					yield* this.deleteCommandSteps(state, context);
					break;
				case 'rename':
					assertStateStepRename(state);
					yield* this.renameCommandSteps(state, context);
					// Clear any chosen name, since we are exiting this subcommand
					state.name = undefined!;
					break;
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
					label: 'create',
					description: 'creates a new branch',
					picked: state.subcommand === 'create',
					item: 'create',
				},
				{
					label: 'delete',
					description: 'deletes the specified branches',
					picked: state.subcommand === 'delete',
					item: 'delete',
				},
				{
					label: 'prune',
					description: 'deletes local branches with missing upstreams',
					picked: state.subcommand === 'prune',
					item: 'prune',
				},
				{
					label: 'rename',
					description: 'renames the specified branch',
					picked: state.subcommand === 'rename',
					item: 'rename',
				},
			],
			buttons: [QuickInputButtons.Back],
		});
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}

	private async *createCommandSteps(state: CreateStepState, context: Context): AsyncStepResultGenerator<void> {
		if (state.flags == null) {
			state.flags = [];
		}

		while (this.canStepsContinue(state)) {
			if (state.counter < 3 || state.reference == null) {
				const result = yield* pickBranchOrTagStep(state, context, {
					placeholder: `Select a base to create the new branch from`,
					picked: state.reference?.ref ?? (await state.repo.git.getBranch())?.ref,
					title: 'Select Base to Create Branch From',
					value: isRevisionReference(state.reference) ? state.reference.ref : undefined,
				});
				// Always break on the first step (so we will go back)
				if (result === StepResultBreak) break;

				state.reference = result;
			}

			if (state.counter < 4 || state.name == null || state.suggestNameOnly) {
				const result = yield* inputBranchNameStep(state, context, {
					titleContext: ` from ${getReferenceLabel(state.reference, {
						capitalize: true,
						icon: false,
						label: state.reference.refType !== 'branch',
					})}`,
					value:
						state.name ?? // if it's a remote branch, pre-fill the name
						(isBranchReference(state.reference) && state.reference.remote
							? getNameWithoutRemote(state.reference)
							: undefined),
				});
				if (result === StepResultBreak) continue;

				state.name = result;
			}

			if (this.confirm(state.confirm)) {
				const result = yield* this.createCommandConfirmStep(state, context);
				if (result === StepResultBreak) continue;

				state.flags = result;
			}

			if (state.flags.includes('--worktree')) {
				const worktreeResult = yield* getSteps(
					this.container,
					{
						command: 'worktree',
						state: {
							subcommand: 'create',
							reference: state.reference,
							createBranch: state.name,
							repo: state.repo,
						},
					},
					this.pickedVia,
				);
				if (worktreeResult !== StepResultBreak) continue;

				endSteps(state);
				return;
			}

			endSteps(state);

			if (state.flags.includes('--switch')) {
				await state.repo.switch(state.reference.ref, { createBranch: state.name });
			} else {
				try {
					await state.repo.git.createBranch(state.name, state.reference.ref);
				} catch (ex) {
					Logger.error(ex);
					// TODO likely need some better error handling here
					return showGenericErrorMessage('Unable to create branch');
				}
			}

			if (state.associateWithIssue != null) {
				const issue = state.associateWithIssue;
				const branch = await state.repo.git.getBranch(state.name);
				// TODO: These descriptors are hacked in. Use an integration function to get the right resource for the issue.
				const owner = getIssueOwner(issue);
				if (branch != null && owner != null) {
					await addAssociatedIssueToBranch(this.container, branch, { ...issue, type: 'issue' }, owner);
				}
			}
		}
	}

	private *createCommandConfirmStep(state: CreateStepState, context: Context): StepResultGenerator<CreateFlags[]> {
		const confirmItems = [];
		if (!state.confirmOptions) {
			confirmItems.push(
				createFlagsQuickPickItem<CreateFlags>(state.flags, [], {
					label: context.title,
					detail: `Will create a new branch named ${state.name} from ${getReferenceLabel(state.reference)}`,
				}),
			);
		}

		if (!state.confirmOptions || state.confirmOptions.includes('--switch')) {
			confirmItems.push(
				createFlagsQuickPickItem<CreateFlags>(state.flags, ['--switch'], {
					label: `Create & Switch to Branch`,
					detail: `Will create and switch to a new branch named ${state.name} from ${getReferenceLabel(
						state.reference,
					)}`,
				}),
			);
		}

		if (!state.confirmOptions || state.confirmOptions.includes('--worktree')) {
			confirmItems.push(
				createFlagsQuickPickItem<CreateFlags>(state.flags, ['--worktree'], {
					label: `${context.title} in New Worktree`,
					description: 'avoids modifying your working tree',
					detail: `Will create a new worktree for a new branch named ${state.name} from ${getReferenceLabel(
						state.reference,
					)}`,
				}),
			);
		}

		const step: QuickPickStep<FlagsQuickPickItem<CreateFlags>> = createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			confirmItems,
			context,
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}

	private async *deleteCommandSteps(
		state: DeleteStepState | PruneStepState,
		context: Context,
	): AsyncStepResultGenerator<void> {
		const prune = state.subcommand === 'prune';
		if (state.flags == null) {
			state.flags = [];
		}

		while (this.canStepsContinue(state)) {
			if (state.references != null && !Array.isArray(state.references)) {
				state.references = [state.references];
			}

			const worktreesByBranch = await getWorktreesByBranch(state.repo, { includeDefault: true });

			if (
				state.counter < 3 ||
				state.references == null ||
				(Array.isArray(state.references) && state.references.length === 0)
			) {
				context.title = getTitle('Branches', state.subcommand);

				const result = yield* pickBranchesStep(state, context, {
					filter: prune
						? b => !b.current && Boolean(b.upstream?.missing) && !worktreesByBranch.get(b.id)?.isDefault
						: b => !b.current && !worktreesByBranch.get(b.id)?.isDefault,
					picked: state.references?.map(r => r.ref),
					placeholder: prune
						? 'Choose branches with missing upstreams to delete'
						: 'Choose branches to delete',
					emptyPlaceholder: prune
						? `No branches with missing upstreams in ${state.repo.formattedName}`
						: undefined,
					sort: { current: false, missingUpstream: true },
				});
				// Always break on the first step (so we will go back)
				if (result === StepResultBreak) break;

				state.references = result;
			}

			context.title = getTitle(
				pluralize('Branch', state.references.length, { only: true, plural: 'Branches' }),
				state.subcommand === 'prune' ? 'delete' : state.subcommand,
			);

			assertStateStepDeleteBranches(state);

			const worktrees = this.getSelectedWorktrees(state, worktreesByBranch);
			if (worktrees.length) {
				const result = yield* getSteps(
					this.container,
					{
						command: 'worktree',
						state: {
							subcommand: 'delete',
							repo: state.repo,
							uris: worktrees.map(wt => wt.uri),
							startingFromBranchDelete: true,
							overrides: {
								title: `Delete ${worktrees.length === 1 ? 'Worktree' : 'Worktrees'} for ${
									worktrees.length === 1 ? 'Branch' : 'Branches'
								}`,
							},
						},
					},
					this.pickedVia,
				);
				if (result !== StepResultBreak) {
					// we get here if it was a step back from the delete worktrees picker
					state.counter--;
					continue;
				}
			}

			const result = yield* this.deleteCommandConfirmStep(state, context);
			if (result === StepResultBreak) continue;

			state.flags = result;

			endSteps(state);
			state.repo.branchDelete(state.references, {
				force: state.flags.includes('--force'),
				remote: state.flags.includes('--remotes'),
			});
		}
	}

	private getSelectedWorktrees(
		state: DeleteStepState | PruneStepState,
		worktreesByBranch: Map<string, GitWorktree>,
	): GitWorktree[] {
		const worktrees: GitWorktree[] = [];

		for (const ref of ensureArray(state.references)) {
			const worktree = worktreesByBranch.get(ref.id!);
			if (worktree != null && !worktree.isDefault) {
				worktrees.push(worktree);
			}
		}

		return worktrees;
	}

	private *deleteCommandConfirmStep(
		state:
			| DeleteStepState<ExcludeSome<DeleteState, 'references', GitBranchReference>>
			| PruneStepState<ExcludeSome<PruneState, 'references', GitBranchReference>>,
		context: Context,
	): StepResultGenerator<DeleteFlags[]> {
		const confirmations: FlagsQuickPickItem<DeleteFlags>[] = [
			createFlagsQuickPickItem<DeleteFlags>(state.flags, [], {
				label: context.title,
				detail: `Will delete ${getReferenceLabel(state.references)}`,
			}),
		];
		if (!state.references.every(b => b.remote)) {
			confirmations.push(
				createFlagsQuickPickItem<DeleteFlags>(state.flags, ['--force'], {
					label: `Force ${context.title}`,
					description: '--force',
					detail: `Will forcibly delete ${getReferenceLabel(state.references)}`,
				}),
			);

			if (state.subcommand !== 'prune' && state.references.some(b => b.upstream != null)) {
				confirmations.push(
					createQuickPickSeparator(),
					createFlagsQuickPickItem<DeleteFlags>(state.flags, ['--remotes'], {
						label: 'Delete Local & Remote Branches',
						description: '--remotes',
						detail: `Will delete ${getReferenceLabel(state.references)} and any remote tracking branches`,
					}),
					createFlagsQuickPickItem<DeleteFlags>(state.flags, ['--force', '--remotes'], {
						label: 'Force Delete Local & Remote Branches',
						description: '--force --remotes',
						detail: `Will forcibly delete ${getReferenceLabel(
							state.references,
						)} and any remote tracking branches`,
					}),
				);
			}
		}

		const step: QuickPickStep<FlagsQuickPickItem<DeleteFlags>> = createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			confirmations,
			context,
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}

	private async *renameCommandSteps(state: RenameStepState, context: Context): AsyncStepResultGenerator<void> {
		if (state.flags == null) {
			state.flags = [];
		}

		while (this.canStepsContinue(state)) {
			if (state.counter < 3 || state.reference == null) {
				const result = yield* pickBranchStep(state, context, {
					filter: b => !b.remote,
					picked: state.reference?.ref,
					placeholder: 'Choose a branch to rename',
				});
				// Always break on the first step (so we will go back)
				if (result === StepResultBreak) break;

				state.reference = result;
			}

			if (state.counter < 4 || state.name == null) {
				const result = yield* inputBranchNameStep(state, context, {
					titleContext: ` ${getReferenceLabel(state.reference, false)}`,
					value: state.name ?? state.reference.name,
				});
				if (result === StepResultBreak) continue;

				state.name = result;
			}

			const result = yield* this.renameCommandConfirmStep(state, context);
			if (result === StepResultBreak) continue;

			state.flags = result;

			endSteps(state);
			try {
				await state.repo.git.renameBranch(state.reference.ref, state.name);
			} catch (ex) {
				Logger.error(ex);
				// TODO likely need some better error handling here
				return showGenericErrorMessage('Unable to rename branch');
			}
		}
	}

	private *renameCommandConfirmStep(state: RenameStepState, context: Context): StepResultGenerator<RenameFlags[]> {
		const step: QuickPickStep<FlagsQuickPickItem<RenameFlags>> = createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			[
				createFlagsQuickPickItem<RenameFlags>(state.flags, ['-m'], {
					label: context.title,
					detail: `Will rename ${getReferenceLabel(state.reference)} to ${state.name}`,
				}),
			],
			context,
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}
}
