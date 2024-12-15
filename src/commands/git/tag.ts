import { QuickInputButtons } from 'vscode';
import type { Container } from '../../container';
import { getNameWithoutRemote } from '../../git/models/branch.utils';
import type { GitReference, GitTagReference } from '../../git/models/reference';
import { getReferenceLabel, isRevisionReference, isTagReference } from '../../git/models/reference.utils';
import type { Repository } from '../../git/models/repository';
import { showGenericErrorMessage } from '../../messages';
import type { QuickPickItemOfT } from '../../quickpicks/items/common';
import type { FlagsQuickPickItem } from '../../quickpicks/items/flags';
import { createFlagsQuickPickItem } from '../../quickpicks/items/flags';
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
	canInputStepContinue,
	canPickStepContinue,
	canStepContinue,
	createConfirmStep,
	createInputStep,
	createPickStep,
	endSteps,
	QuickCommand,
	StepResultBreak,
} from '../quickCommand';
import {
	appendReposToTitle,
	inputTagNameStep,
	pickBranchOrTagStep,
	pickRepositoryStep,
	pickTagsStep,
} from '../quickCommand.steps';

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
	['create', 'Create'],
	['delete', 'Delete'],
]);
function getTitle(title: string, subcommand: State['subcommand'] | undefined) {
	return subcommand == null ? title : `${subcommandToTitleMap.get(subcommand)} ${title}`;
}

export interface TagGitCommandArgs {
	readonly command: 'tag';
	confirm?: boolean;
	state?: Partial<State>;
}

export class TagGitCommand extends QuickCommand<State> {
	private subcommand: State['subcommand'] | undefined;

	constructor(container: Container, args?: TagGitCommandArgs) {
		super(container, 'tag', 'tag', 'Tag', {
			description: 'create, or delete tags',
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
			associatedView: this.container.views.tags,
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

			context.title = getTitle(state.subcommand === 'delete' ? 'Tags' : this.title, state.subcommand);

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
					description: 'creates a new tag',
					picked: state.subcommand === 'create',
					item: 'create',
				},
				{
					label: 'delete',
					description: 'deletes the specified tags',
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
		if (state.flags == null) {
			state.flags = [];
		}

		while (this.canStepsContinue(state)) {
			if (state.counter < 3 || state.reference == null) {
				const result = yield* pickBranchOrTagStep(state, context, {
					placeholder: context =>
						`Choose a branch${context.showTags ? ' or tag' : ''} to create the new tag from`,
					picked: state.reference?.ref ?? (await state.repo.git.getBranch())?.ref,
					titleContext: ' from',
					value: isRevisionReference(state.reference) ? state.reference.ref : undefined,
				});
				// Always break on the first step (so we will go back)
				if (result === StepResultBreak) break;

				state.reference = result;
			}

			if (state.counter < 4 || state.name == null) {
				const result = yield* inputTagNameStep(state, context, {
					placeholder: 'Please provide a name for the new tag',
					titleContext: ` at ${getReferenceLabel(state.reference, {
						capitalize: true,
						icon: false,
					})}`,
					value:
						state.name ?? // if it's not a tag, pre-fill the name
						(!isTagReference(state.reference) ? getNameWithoutRemote(state.reference) : undefined),
				});
				if (result === StepResultBreak) continue;

				state.name = result;
			}

			if (state.counter < 5 || state.message == null) {
				const result = yield* this.createCommandInputMessageStep(state, context);
				if (result === StepResultBreak) continue;

				state.message = result;
			}

			if (state.message.length !== 0 && !state.flags.includes('-m')) {
				state.flags.push('-m');
			}

			if (this.confirm(state.confirm)) {
				const result = yield* this.createCommandConfirmStep(state, context);
				if (result === StepResultBreak) continue;

				state.flags = result;
			}

			endSteps(state);
			try {
				await state.repo.git.createTag(state.name, state.reference.ref, state.message);
			} catch (ex) {
				Logger.error(ex, context.title);
				void showGenericErrorMessage(ex);
			}
		}
	}

	private async *createCommandInputMessageStep(
		state: CreateStepState,
		context: Context,
	): AsyncStepResultGenerator<string> {
		const step = createInputStep({
			title: appendReposToTitle(
				`${context.title} at ${getReferenceLabel(state.reference, {
					capitalize: true,
					icon: false,
				})}`,
				state,
				context,
			),
			placeholder: 'Please provide an optional message to annotate the tag',
			value: state.message,
			prompt: 'Enter optional message',
		});

		const value: StepSelection<typeof step> = yield step;

		if (!canStepContinue(step, state, value) || !(await canInputStepContinue(step, state, value))) {
			return StepResultBreak;
		}

		return value;
	}

	private *createCommandConfirmStep(state: CreateStepState, context: Context): StepResultGenerator<CreateFlags[]> {
		const step: QuickPickStep<FlagsQuickPickItem<CreateFlags>> = createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			[
				createFlagsQuickPickItem<CreateFlags>(state.flags, state.message.length !== 0 ? ['-m'] : [], {
					label: context.title,
					description: state.message.length !== 0 ? '-m' : '',
					detail: `Will create a new tag named ${state.name} at ${getReferenceLabel(state.reference)}`,
				}),
				createFlagsQuickPickItem<CreateFlags>(
					state.flags,
					state.message.length !== 0 ? ['--force', '-m'] : ['--force'],
					{
						label: `Force ${context.title}`,
						description: `--force${state.message.length !== 0 ? ' -m' : ''}`,
						detail: `Will forcibly create a new tag named ${state.name} at ${getReferenceLabel(
							state.reference,
						)}`,
					},
				),
			],
			context,
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}

	private async *deleteCommandSteps(state: DeleteStepState, context: Context): StepGenerator {
		while (this.canStepsContinue(state)) {
			if (state.references != null && !Array.isArray(state.references)) {
				state.references = [state.references];
			}

			if (state.counter < 3 || state.references == null || state.references.length === 0) {
				context.title = getTitle('Tags', state.subcommand);

				const result = yield* pickTagsStep(state, context, {
					picked: state.references?.map(r => r.ref),
					placeholder: 'Choose tags to delete',
				});
				// Always break on the first step (so we will go back)
				if (result === StepResultBreak) break;

				state.references = result;
			}

			context.title = getTitle(pluralize('Tag', state.references.length, { only: true }), state.subcommand);

			const result = yield* this.deleteCommandConfirmStep(state, context);
			if (result === StepResultBreak) continue;

			endSteps(state);
			for (const { ref } of state.references) {
				try {
					await state.repo.git.deleteTag(ref);
				} catch (ex) {
					Logger.error(ex, context.title);
					void showGenericErrorMessage(ex);
				}
			}
		}
	}

	private *deleteCommandConfirmStep(state: DeleteStepState, context: Context): StepResultGenerator<void> {
		const step: QuickPickStep = createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			[
				{
					label: context.title,
					detail: `Will delete ${getReferenceLabel(state.references)}`,
				},
			],
			context,
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? undefined : StepResultBreak;
	}
}
