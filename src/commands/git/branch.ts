'use strict';
import { QuickInputButtons } from 'vscode';
import { Container } from '../../container';
import { GitBranchReference, GitReference, Repository } from '../../git/git';
import {
	appendReposToTitle,
	inputBranchNameStep,
	PartialStepState,
	pickBranchesStep,
	pickBranchOrTagStep,
	pickBranchStep,
	pickRepositoryStep,
	QuickCommand,
	QuickPickStep,
	StepGenerator,
	StepResult,
	StepResultGenerator,
	StepSelection,
	StepState,
} from '../quickCommand';
import { FlagsQuickPickItem, QuickPickItemOfT } from '../../quickpicks';
import { Strings } from '../../system';

interface Context {
	repos: Repository[];
	showTags: boolean;
	title: string;
}

type CreateFlags = '--switch';

interface CreateState {
	subcommand: 'create';
	repo: string | Repository;
	reference: GitReference;
	name: string;
	flags: CreateFlags[];
}

type DeleteFlags = '--force' | '--remotes';

interface DeleteState {
	subcommand: 'delete';
	repo: string | Repository;
	references: GitBranchReference | GitBranchReference[];
	flags: DeleteFlags[];
}

type RenameFlags = '-m';

interface RenameState {
	subcommand: 'rename';
	repo: string | Repository;
	reference: GitBranchReference;
	name: string;
	flags: RenameFlags[];
}

type State = CreateState | DeleteState | RenameState;
type BranchStepState<T extends State> = SomeNonNullable<StepState<T>, 'subcommand'>;
type CreateStepState<T extends CreateState = CreateState> = BranchStepState<ExcludeSome<T, 'repo', string>>;
type DeleteStepState<T extends DeleteState = DeleteState> = BranchStepState<ExcludeSome<T, 'repo', string>>;
type RenameStepState<T extends RenameState = RenameState> = BranchStepState<ExcludeSome<T, 'repo', string>>;

const subcommandToTitleMap = new Map<State['subcommand'], string>([
	['create', 'Create'],
	['delete', 'Delete'],
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

export class BranchGitCommand extends QuickCommand<State> {
	private subcommand: State['subcommand'] | undefined;

	constructor(args?: BranchGitCommandArgs) {
		super('branch', 'branch', 'Branch', {
			description: 'create, rename, or delete branches',
		});

		let counter = 0;
		if (args?.state?.subcommand != null) {
			counter++;

			switch (args?.state.subcommand) {
				case 'create':
					if (args.state.reference != null) {
						counter++;
					}

					if (args.state.name != null) {
						counter++;
					}

					break;
				case 'delete':
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

	get canConfirm(): boolean {
		return this.subcommand != null;
	}

	get canSkipConfirm(): boolean {
		return this.subcommand === 'delete' || this.subcommand === 'rename' ? false : super.canSkipConfirm;
	}

	get skipConfirmKey() {
		return `${this.key}${this.subcommand == null ? '' : `-${this.subcommand}`}:${this.pickedVia}`;
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: [...(await Container.git.getOrderedRepositories())],
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

			context.title = getTitle(state.subcommand === 'delete' ? 'Branches' : this.title, state.subcommand);

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

			switch (state.subcommand) {
				case 'create':
					yield* this.createCommandSteps(state as CreateStepState, context);
					// Clear any chosen name, since we are exiting this subcommand
					state.name = undefined;
					break;
				case 'delete':
					yield* this.deleteCommandSteps(state as DeleteStepState, context);
					break;
				case 'rename':
					yield* this.renameCommandSteps(state as RenameStepState, context);
					// Clear any chosen name, since we are exiting this subcommand
					state.name = undefined;
					break;
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
					label: 'rename',
					description: 'renames the specified branch',
					picked: state.subcommand === 'rename',
					item: 'rename',
				},
			],
			buttons: [QuickInputButtons.Back],
		});
		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
	}

	private async *createCommandSteps(state: CreateStepState, context: Context): StepResultGenerator<void> {
		if (state.flags == null) {
			state.flags = [];
		}

		while (this.canStepsContinue(state)) {
			if (state.counter < 3 || state.reference == null) {
				const result = yield* pickBranchOrTagStep(state, context, {
					placeholder: context =>
						`Choose a branch${context.showTags ? ' or tag' : ''} to create the new branch from`,
					picked: state.reference?.ref ?? (await state.repo.getBranch())?.ref,
					value: GitReference.isRevision(state.reference) ? state.reference.ref : undefined,
				});
				// Always break on the first step (so we will go back)
				if (result === StepResult.Break) break;

				state.reference = result;
			}

			if (state.counter < 4 || state.name == null) {
				const result = yield* inputBranchNameStep(state, context, {
					placeholder: 'Please provide a name for the new branch',
					titleContext: ` ${GitReference.toString(state.reference, { capitalize: true, icon: false })}`,
					value: state.name ?? GitReference.getNameWithoutRemote(state.reference),
				});
				if (result === StepResult.Break) continue;

				state.name = result;
			}

			if (this.confirm(state.confirm)) {
				const result = yield* this.createCommandConfirmStep(state, context);
				if (result === StepResult.Break) continue;

				state.flags = result;
			}

			QuickCommand.endSteps(state);
			if (state.flags.includes('--switch')) {
				void (await state.repo.switch(state.reference.ref, { createBranch: state.name }));
			} else {
				void state.repo.branch(...state.flags, state.name, state.reference.ref);
			}
		}
	}

	private *createCommandConfirmStep(
		state: CreateStepState<CreateState>,
		context: Context,
	): StepResultGenerator<CreateFlags[]> {
		const step: QuickPickStep<FlagsQuickPickItem<CreateFlags>> = QuickCommand.createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			[
				FlagsQuickPickItem.create<CreateFlags>(state.flags, [], {
					label: context.title,
					detail: `Will create a new branch named ${state.name} from ${GitReference.toString(
						state.reference,
					)}`,
				}),
				FlagsQuickPickItem.create<CreateFlags>(state.flags, ['--switch'], {
					label: `${context.title} and Switch`,
					description: '--switch',
					detail: `Will create and switch to a new branch named ${state.name} from ${GitReference.toString(
						state.reference,
					)}`,
				}),
			],
			context,
		);
		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	private async *deleteCommandSteps(state: DeleteStepState, context: Context): StepResultGenerator<void> {
		if (state.flags == null) {
			state.flags = [];
		}

		while (this.canStepsContinue(state)) {
			if (state.references != null && !Array.isArray(state.references)) {
				state.references = [state.references];
			}

			if (
				state.counter < 3 ||
				state.references == null ||
				(Array.isArray(state.references) && state.references.length === 0)
			) {
				context.title = getTitle('Branches', state.subcommand);

				const result = yield* pickBranchesStep(state, context, {
					filterBranches: b => !b.current,
					picked: state.references?.map(r => r.ref),
					placeholder: 'Choose branches to delete',
				});
				// Always break on the first step (so we will go back)
				if (result === StepResult.Break) break;

				state.references = result;
			}

			context.title = getTitle(
				Strings.pluralize('Branch', state.references.length, {
					number: '',
					suffix: 'es',
				}).trim(),
				state.subcommand,
			);

			const result = yield* this.deleteCommandConfirmStep(
				state as ExcludeSome<typeof state, 'references', GitBranchReference>,
				context,
			);
			if (result === StepResult.Break) continue;

			state.flags = result;

			QuickCommand.endSteps(state);
			void state.repo.branchDelete(state.references, {
				force: state.flags.includes('--force'),
				remote: state.flags.includes('--remotes'),
			});
		}
	}

	private *deleteCommandConfirmStep(
		state: DeleteStepState<ExcludeSome<DeleteState, 'references', GitBranchReference>>,
		context: Context,
	): StepResultGenerator<DeleteFlags[]> {
		const confirmations: FlagsQuickPickItem<DeleteFlags>[] = [
			FlagsQuickPickItem.create<DeleteFlags>(state.flags, [], {
				label: context.title,
				detail: `Will delete ${GitReference.toString(state.references)}`,
			}),
		];
		if (!state.references.every(b => b.remote)) {
			confirmations.push(
				FlagsQuickPickItem.create<DeleteFlags>(state.flags, ['--force'], {
					label: `Force ${context.title}`,
					description: '--force',
					detail: `Will forcibly delete ${GitReference.toString(state.references)}`,
				}),
			);

			if (state.references.some(b => b.tracking != null)) {
				confirmations.push(
					FlagsQuickPickItem.create<DeleteFlags>(state.flags, ['--remotes'], {
						label: `${context.title} & Remote${
							state.references.filter(b => !b.remote).length > 1 ? 's' : ''
						}`,
						description: '--remotes',
						detail: `Will delete ${GitReference.toString(
							state.references,
						)} and any remote tracking branches`,
					}),
					FlagsQuickPickItem.create<DeleteFlags>(state.flags, ['--force', '--remotes'], {
						label: `Force ${context.title} & Remote${
							state.references.filter(b => !b.remote).length > 1 ? 's' : ''
						}`,
						description: '--force --remotes',
						detail: `Will forcibly delete ${GitReference.toString(
							state.references,
						)} and any remote tracking branches`,
					}),
				);
			}
		}

		const step: QuickPickStep<FlagsQuickPickItem<DeleteFlags>> = QuickCommand.createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			confirmations,
			context,
		);
		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	private async *renameCommandSteps(state: RenameStepState, context: Context): StepResultGenerator<void> {
		if (state.flags == null) {
			state.flags = [];
		}

		while (this.canStepsContinue(state)) {
			if (state.counter < 3 || state.reference == null) {
				const result = yield* pickBranchStep(state, context, {
					filterBranches: b => !b.remote,
					picked: state.reference?.ref,
					placeholder: 'Choose a branch to rename',
				});
				// Always break on the first step (so we will go back)
				if (result === StepResult.Break) break;

				state.reference = result;
			}

			if (state.counter < 4 || state.name == null) {
				const result = yield* inputBranchNameStep(state, context, {
					placeholder: `Please provide a new name for ${GitReference.toString(state.reference, {
						icon: false,
					})}`,
					titleContext: ` ${GitReference.toString(state.reference, false)}`,
					value: state.name ?? state.reference.name,
				});
				if (result === StepResult.Break) continue;

				state.name = result;
			}

			const result = yield* this.renameCommandConfirmStep(state, context);
			if (result === StepResult.Break) continue;

			state.flags = result;

			QuickCommand.endSteps(state);
			void state.repo.branch(...state.flags, state.reference.ref, state.name);
		}
	}

	private *renameCommandConfirmStep(
		state: RenameStepState<RenameState>,
		context: Context,
	): StepResultGenerator<RenameFlags[]> {
		const step: QuickPickStep<FlagsQuickPickItem<RenameFlags>> = QuickCommand.createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			[
				FlagsQuickPickItem.create<RenameFlags>(state.flags, ['-m'], {
					label: context.title,
					detail: `Will rename ${GitReference.toString(state.reference)} to ${state.name}`,
				}),
			],
			context,
		);
		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
	}
}
