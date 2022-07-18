import type { QuickPickItem } from 'vscode';
import { QuickInputButtons } from 'vscode';
import * as nls from 'vscode-nls';
import type { Container } from '../../container';
import type { GitTagReference } from '../../git/models/reference';
import { GitReference } from '../../git/models/reference';
import type { Repository } from '../../git/models/repository';
import type { QuickPickItemOfT } from '../../quickpicks/items/common';
import { FlagsQuickPickItem } from '../../quickpicks/items/flags';
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
	appendReposToTitle,
	inputTagNameStep,
	pickBranchOrTagStep,
	pickRepositoryStep,
	pickTagsStep,
	QuickCommand,
	StepResult,
} from '../quickCommand';

const localize = nls.loadMessageBundle();

interface Context {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	showTags: boolean;
	title: string;
}

type CreateFlags = '--force' | '-m';

interface CreateState {
	subcommand: 'create';
	repo: string | Repository;
	reference: GitReference;
	name: string;
	message: string;
	flags: CreateFlags[];
}

interface DeleteState {
	subcommand: 'delete';
	repo: string | Repository;
	references: GitTagReference | GitTagReference[];
}

type State = CreateState | DeleteState;
type TagStepState<T extends State> = SomeNonNullable<StepState<T>, 'subcommand'>;
type CreateStepState<T extends CreateState = CreateState> = TagStepState<ExcludeSome<T, 'repo', string>>;
type DeleteStepState<T extends DeleteState = DeleteState> = TagStepState<ExcludeSome<T, 'repo', string>>;

const subcommandToTitleMap = new Map<State['subcommand'], string>([
	['create', localize('subcommand.create.title', 'Create Tag')],
	['delete', localize('subcommand.delete.title.plural', 'Delete Tags')],
]);

function getTitle(placeholder: string, subcommand: State['subcommand'] | undefined) {
	return subcommand == null ? placeholder : subcommandToTitleMap.get(subcommand) ?? placeholder;
}

export interface TagGitCommandArgs {
	readonly command: 'tag';
	confirm?: boolean;
	state?: Partial<State>;
}

export class TagGitCommand extends QuickCommand<State> {
	private subcommand: State['subcommand'] | undefined;

	constructor(container: Container, args?: TagGitCommandArgs) {
		super(container, 'tag', localize('label', 'tag'), localize('title', 'Tag'), {
			description: localize('description', 'create, or delete tags'),
		});

		let counter = 0;
		if (args?.state?.subcommand != null) {
			counter++;

			switch (args.state.subcommand) {
				case 'create':
					if (args.state.reference != null) {
						counter++;
					}

					if (args.state.name != null) {
						counter++;
					}

					if (args.state.message != null) {
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
		return this.subcommand === 'delete' ? false : super.canSkipConfirm;
	}

	override get skipConfirmKey() {
		return `${this.key}${this.subcommand == null ? '' : `-${this.subcommand}`}:${this.pickedVia}`;
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: this.container.git.openRepositories,
			associatedView: this.container.tagsView,
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

			context.title = getTitle(
				state.subcommand === 'delete' ? localize('title.placeholder.tags', 'Tags') : this.title,
				state.subcommand,
			);

			switch (state.subcommand) {
				case 'create': {
					yield* this.createCommandSteps(state as CreateStepState, context);
					// Clear any chosen name, since we are exiting this subcommand
					state.name = undefined;
					break;
				}
				case 'delete':
					yield* this.deleteCommandSteps(state as DeleteStepState, context);
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
			placeholder: localize('pickSubcommandStep.placeholder', 'Choose a {0} command', this.label),
			items: [
				{
					label: localize('pickSubcommandStep.create.label', 'create'),
					description: localize('pickSubcommandStep.create.description', 'creates a new tag'),
					picked: state.subcommand === 'create',
					item: 'create',
				},
				{
					label: localize('pickSubcommandStep.delete.label', 'delete'),
					description: localize('pickSubcommandStep.delete.label', 'deletes the specified tags'),
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
		if (state.flags == null) {
			state.flags = [];
		}

		while (this.canStepsContinue(state)) {
			if (state.counter < 3 || state.reference == null) {
				const result = yield* pickBranchOrTagStep(state, context, {
					placeholder: context =>
						context.showTags
							? localize(
									'pickBranchOrTagStep.placeholder.chooseBranchOrTagToCreateTagFrom',
									'Choose a branch or tag to create the new tag from',
							  )
							: localize(
									'pickBranchOrTagStep.placeholder.chooseBranchToCreateTagFrom',
									'Choose a branch to create the new tag from',
							  ),
					picked: state.reference?.ref ?? (await state.repo.getBranch())?.ref,
					titleContext: ` ${localize('pickBranchOrTagStep.from', 'from')}`,
					value: GitReference.isRevision(state.reference) ? state.reference.ref : undefined,
				});
				// Always break on the first step (so we will go back)
				if (result === StepResult.Break) break;

				state.reference = result;
			}

			if (state.counter < 4 || state.name == null) {
				const result = yield* inputTagNameStep(state, context, {
					placeholder: localize(
						'inputTagNameStep.placeholder.provideNameForNewTag',
						'Please provide a name for the new tag',
					),
					titleContext: ` ${localize(
						'inputTagNameStep.atRef',
						'at {0}',
						GitReference.toString(state.reference, { capitalize: true, icon: false }),
					)}`,
					value: state.name ?? GitReference.getNameWithoutRemote(state.reference),
				});
				if (result === StepResult.Break) continue;

				state.name = result;
			}

			if (state.counter < 5 || state.message == null) {
				const result = yield* this.createCommandInputMessageStep(state, context);
				if (result === StepResult.Break) continue;

				state.message = result;
			}

			if (state.message.length !== 0 && !state.flags.includes('-m')) {
				state.flags.push('-m');
			}

			if (this.confirm(state.confirm)) {
				const result = yield* this.createCommandConfirmStep(state, context);
				if (result === StepResult.Break) continue;

				state.flags = result;
			}

			QuickCommand.endSteps(state);
			state.repo.tag(
				...state.flags,
				...(state.message.length !== 0 ? [`"${state.message}"`] : []),
				state.name,
				state.reference.ref,
			);
		}
	}

	private async *createCommandInputMessageStep(
		state: CreateStepState,
		context: Context,
	): AsyncStepResultGenerator<string> {
		const step = QuickCommand.createInputStep({
			title: appendReposToTitle(
				localize(
					'createCommandInputMessageStep.title.createOrDeleteTagAtRef',
					'{0} at {1}',
					context.title,
					GitReference.toString(state.reference, { capitalize: true, icon: false }),
				),
				state,
				context,
			),
			placeholder: localize(
				'createCommandInputMessageStep.placeholder',
				'Please provide an optional message to annotate the tag',
			),
			value: state.message,
			prompt: localize('createCommandInputMessageStep.prompt', 'Enter optional message'),
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
		state: CreateStepState<CreateState>,
		context: Context,
	): StepResultGenerator<CreateFlags[]> {
		const step: QuickPickStep<FlagsQuickPickItem<CreateFlags>> = QuickCommand.createConfirmStep(
			appendReposToTitle(localize('confirm', 'Confirm {0}', context.title), state, context),
			[
				FlagsQuickPickItem.create<CreateFlags>(state.flags, state.message.length !== 0 ? ['-m'] : [], {
					label: context.title,
					description: state.message.length !== 0 ? '-m' : '',
					detail: localize(
						'createCommandConfirmStep.detail',
						'Will create a new tag named {0} at {1}',
						state.name,
						GitReference.toString(state.reference),
					),
				}),
				FlagsQuickPickItem.create<CreateFlags>(
					state.flags,
					state.message.length !== 0 ? ['--force', '-m'] : ['--force'],
					{
						label: localize('createCommandConfirmStep.force.label', 'Force {0}', context.title),
						description: `--force${state.message.length !== 0 ? ' -m' : ''}`,
						detail: localize(
							'createCommandConfirmStep.force.detail',
							'Will forcibly create a new tag named {0} at {1}',
							state.name,
							GitReference.toString(state.reference),
						),
					},
				),
			],
			context,
		);
		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
	}

	private async *deleteCommandSteps(state: DeleteStepState, context: Context): StepGenerator {
		while (this.canStepsContinue(state)) {
			if (state.references != null && !Array.isArray(state.references)) {
				state.references = [state.references];
			}

			if (state.counter < 3 || state.references == null || state.references.length === 0) {
				context.title = localize('subcommand.delete.title.plural', 'Delete Tags');

				const result = yield* pickTagsStep(state, context, {
					picked: state.references?.map(r => r.ref),
					placeholder: localize('pickTagsStep.placeholder', 'Choose tags to delete'),
				});
				// Always break on the first step (so we will go back)
				if (result === StepResult.Break) break;

				state.references = result;
			}

			context.title =
				state.references.length === 1
					? localize('subcommand.delete.title', 'Delete Tag')
					: localize('subcommand.delete.title.plural', 'Delete Tags');

			const result = yield* this.deleteCommandConfirmStep(state, context);
			if (result === StepResult.Break) continue;

			QuickCommand.endSteps(state);
			state.repo.tagDelete(state.references);
		}
	}

	private *deleteCommandConfirmStep(
		state: DeleteStepState<DeleteState>,
		context: Context,
	): StepResultGenerator<void> {
		const step: QuickPickStep<QuickPickItem> = QuickCommand.createConfirmStep(
			appendReposToTitle(localize('confirm', 'Confirm {0}', context.title), state, context),
			[
				{
					label: context.title,
					detail: localize(
						'deleteCommandConfirmStep.detail',
						'Will delete {0}',
						GitReference.toString(state.references),
					),
				},
			],
			context,
		);
		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? undefined : StepResult.Break;
	}
}
