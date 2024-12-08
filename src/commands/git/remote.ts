import { QuickInputButtons } from 'vscode';
import type { Container } from '../../container';
import { reveal } from '../../git/actions/remote';
import type { GitRemote } from '../../git/models/remote';
import { Repository } from '../../git/models/repository';
import { showGenericErrorMessage } from '../../messages';
import type { QuickPickItemOfT } from '../../quickpicks/items/common';
import type { FlagsQuickPickItem } from '../../quickpicks/items/flags';
import { createFlagsQuickPickItem } from '../../quickpicks/items/flags';
import { Logger } from '../../system/logger';
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
	inputRemoteNameStep,
	inputRemoteUrlStep,
	pickRemoteStep,
	pickRepositoryStep,
} from '../quickCommand.steps';

interface Context {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	title: string;
}

type AddFlags = '-f';

interface AddState {
	subcommand: 'add';
	repo: string | Repository;
	name: string;
	url: string;
	flags: AddFlags[];

	reveal?: boolean;
}

interface RemoveState {
	subcommand: 'remove';
	repo: string | Repository;
	remote: string | GitRemote;
}

interface PruneState {
	subcommand: 'prune';
	repo: string | Repository;
	remote: string | GitRemote;
}

type State = AddState | RemoveState | PruneState;
type RemoteStepState<T extends State> = SomeNonNullable<StepState<T>, 'subcommand'>;

type AddStepState<T extends AddState = AddState> = RemoteStepState<ExcludeSome<T, 'repo', string>>;
function assertStateStepAdd(state: PartialStepState<State>): asserts state is AddStepState {
	if (state.repo instanceof Repository && state.subcommand === 'add') return;

	debugger;
	throw new Error('Missing repository');
}

type RemoveStepState<T extends RemoveState = RemoveState> = RemoteStepState<ExcludeSome<T, 'repo', string>>;
function assertStateStepRemove(state: PartialStepState<State>): asserts state is RemoveStepState {
	if (state.repo instanceof Repository && state.subcommand === 'remove') return;

	debugger;
	throw new Error('Missing repository');
}

type PruneStepState<T extends PruneState = PruneState> = RemoteStepState<ExcludeSome<T, 'repo', string>>;
function assertStateStepPrune(state: PartialStepState<State>): asserts state is PruneStepState {
	if (state.repo instanceof Repository && state.subcommand === 'prune') return;

	debugger;
	throw new Error('Missing repository');
}

function assertStateStepRemoveRemotes(
	state: RemoveStepState,
): asserts state is ExcludeSome<typeof state, 'remote', string> {
	if (typeof state.remote !== 'string') return;

	debugger;
	throw new Error('Missing remote');
}

function assertStateStepPruneRemotes(
	state: PruneStepState,
): asserts state is ExcludeSome<typeof state, 'remote', string> {
	if (typeof state.remote !== 'string') return;

	debugger;
	throw new Error('Missing remote');
}

const subcommandToTitleMap = new Map<State['subcommand'], string>([
	['add', 'Add'],
	['prune', 'Prune'],
	['remove', 'Remove'],
]);
function getTitle(title: string, subcommand: State['subcommand'] | undefined) {
	return subcommand == null ? title : `${subcommandToTitleMap.get(subcommand)} ${title}`;
}

export interface RemoteGitCommandArgs {
	readonly command: 'remote';
	confirm?: boolean;
	state?: Partial<State>;
}

export class RemoteGitCommand extends QuickCommand<State> {
	private subcommand: State['subcommand'] | undefined;

	constructor(container: Container, args?: RemoteGitCommandArgs) {
		super(container, 'remote', 'remote', 'Remote', {
			description: 'add, prune, or remove remotes',
		});

		let counter = 0;
		if (args?.state?.subcommand != null) {
			counter++;

			switch (args?.state.subcommand) {
				case 'add':
					if (args.state.name != null) {
						counter++;
					}

					if (args.state.url != null) {
						counter++;
					}

					break;
				case 'prune':
				case 'remove':
					if (args.state.remote != null) {
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
		return this.subcommand === 'remove' || this.subcommand === 'prune' ? false : super.canSkipConfirm;
	}

	override get skipConfirmKey() {
		return `${this.key}${this.subcommand == null ? '' : `-${this.subcommand}`}:${this.pickedVia}`;
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.remotes,
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

			context.title = getTitle(this.title, state.subcommand);

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

			switch (state.subcommand) {
				case 'add':
					assertStateStepAdd(state);
					yield* this.addCommandSteps(state, context);
					// Clear any chosen name, since we are exiting this subcommand
					state.name = undefined!;
					state.url = undefined!;
					break;
				case 'prune':
					assertStateStepPrune(state);
					yield* this.pruneCommandSteps(state, context);
					break;
				case 'remove':
					assertStateStepRemove(state);
					yield* this.removeCommandSteps(state, context);
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
					label: 'add',
					description: 'adds a new remote',
					picked: state.subcommand === 'add',
					item: 'add',
				},
				{
					label: 'prune',
					description: 'prunes remote branches on the specified remote',
					picked: state.subcommand === 'prune',
					item: 'prune',
				},
				{
					label: 'remove',
					description: 'removes the specified remote',
					picked: state.subcommand === 'remove',
					item: 'remove',
				},
			],
			buttons: [QuickInputButtons.Back],
		});
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}

	private async *addCommandSteps(state: AddStepState, context: Context): AsyncStepResultGenerator<void> {
		if (state.flags == null) {
			state.flags = ['-f'];
		}

		let alreadyExists = (await state.repo.git.getRemotes({ filter: r => r.name === state.name })).length !== 0;

		while (this.canStepsContinue(state)) {
			if (state.counter < 3 || state.name == null || alreadyExists) {
				const result = yield* inputRemoteNameStep(state, context, {
					placeholder: 'Please provide a name for the remote',
					value: state.name,
				});
				if (result === StepResultBreak) continue;

				alreadyExists = (await state.repo.git.getRemotes({ filter: r => r.name === result })).length !== 0;
				if (alreadyExists) {
					state.counter--;
					continue;
				}

				state.name = result;
			}

			if (state.counter < 4 || state.url == null) {
				const result = yield* inputRemoteUrlStep(state, context, {
					placeholder: 'Please provide a URL for the remote',
					value: state.url,
				});
				if (result === StepResultBreak) continue;

				state.url = result;
			}

			if (this.confirm(state.confirm)) {
				const result = yield* this.addCommandConfirmStep(state, context);
				if (result === StepResultBreak) continue;

				state.flags = result;
			}

			endSteps(state);

			const remote = await state.repo.addRemote(
				state.name,
				state.url,
				state.flags.includes('-f') ? { fetch: true } : undefined,
			);
			if (state.reveal !== false) {
				void reveal(remote, {
					focus: true,
					select: true,
				});
			}
		}
	}

	private *addCommandConfirmStep(state: AddStepState, context: Context): StepResultGenerator<AddFlags[]> {
		const step: QuickPickStep<FlagsQuickPickItem<AddFlags>> = createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			[
				createFlagsQuickPickItem<AddFlags>(state.flags, [], {
					label: context.title,
					detail: `Will add remote '${state.name}' for ${state.url}`,
				}),
				createFlagsQuickPickItem<AddFlags>(state.flags, ['-f'], {
					label: `${context.title} and Fetch`,
					description: '-f',
					detail: `Will add and fetch remote '${state.name}' for ${state.url}`,
				}),
			],
			context,
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}

	private async *removeCommandSteps(state: RemoveStepState, context: Context): AsyncStepResultGenerator<void> {
		while (this.canStepsContinue(state)) {
			if (state.remote != null) {
				if (typeof state.remote === 'string') {
					const [remote] = await state.repo.git.getRemotes({ filter: r => r.name === state.remote });
					if (remote != null) {
						state.remote = remote;
					} else {
						state.remote = undefined!;
					}
				}
			}

			if (state.counter < 3 || state.remote == null) {
				const result = yield* pickRemoteStep(state, context, {
					picked: state.remote?.name,
					placeholder: 'Choose remote to remove',
				});
				// Always break on the first step (so we will go back)
				if (result === StepResultBreak) break;

				state.remote = result;
			}

			assertStateStepRemoveRemotes(state);
			const result = yield* this.removeCommandConfirmStep(state, context);
			if (result === StepResultBreak) continue;

			endSteps(state);
			try {
				await state.repo.git.removeRemote(state.remote.name);
			} catch (ex) {
				Logger.error(ex);
				void showGenericErrorMessage('Unable to remove remote');
			}
		}
	}

	private *removeCommandConfirmStep(
		state: RemoveStepState<ExcludeSome<RemoveState, 'remote', string>>,
		context: Context,
	): StepResultGenerator<void> {
		const step: QuickPickStep = createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			[
				{
					label: context.title,
					detail: `Will remove remote '${state.remote.name}'`,
				},
			],
			context,
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? undefined : StepResultBreak;
	}

	private async *pruneCommandSteps(state: PruneStepState, context: Context): AsyncStepResultGenerator<void> {
		while (this.canStepsContinue(state)) {
			if (state.remote != null) {
				if (typeof state.remote === 'string') {
					const [remote] = await state.repo.git.getRemotes({ filter: r => r.name === state.remote });
					if (remote != null) {
						state.remote = remote;
					} else {
						state.remote = undefined!;
					}
				}
			}

			if (state.counter < 3 || state.remote == null) {
				const result = yield* pickRemoteStep(state, context, {
					picked: state.remote?.name,
					placeholder: 'Choose a remote to prune',
				});
				// Always break on the first step (so we will go back)
				if (result === StepResultBreak) break;

				state.remote = result;
			}

			assertStateStepPruneRemotes(state);
			const result = yield* this.pruneCommandConfirmStep(state, context);
			if (result === StepResultBreak) continue;

			endSteps(state);
			void state.repo.git.pruneRemote(state.remote.name);
		}
	}

	private *pruneCommandConfirmStep(
		state: PruneStepState<ExcludeSome<PruneState, 'remote', string>>,
		context: Context,
	): StepResultGenerator<void> {
		const step: QuickPickStep = createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			[
				{
					label: context.title,
					detail: `Will prune remote '${state.remote.name}'`,
				},
			],
			context,
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? undefined : StepResultBreak;
	}
}
