import { GlyphChars } from '../../constants';
import type { Container } from '../../container';
import type { GitBranchReference } from '../../git/models/reference';
import { getReferenceLabel, isBranchReference } from '../../git/models/reference.utils';
import type { Repository } from '../../git/models/repository';
import type { FlagsQuickPickItem } from '../../quickpicks/items/flags';
import { createFlagsQuickPickItem } from '../../quickpicks/items/flags';
import { isStringArray } from '../../system/array';
import { fromNow } from '../../system/date';
import { pad } from '../../system/string';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase';
import type {
	AsyncStepResultGenerator,
	PartialStepState,
	QuickPickStep,
	StepGenerator,
	StepSelection,
	StepState,
} from '../quickCommand';
import { canPickStepContinue, createConfirmStep, endSteps, QuickCommand, StepResultBreak } from '../quickCommand';
import { appendReposToTitle, pickRepositoriesStep } from '../quickCommand.steps';

interface Context {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	title: string;
}

type Flags = '--all' | '--prune';

interface State {
	repos: string | string[] | Repository | Repository[];
	reference?: GitBranchReference;
	flags: Flags[];
}

export interface FetchGitCommandArgs {
	readonly command: 'fetch';
	confirm?: boolean;
	state?: Partial<State>;
}

type FetchStepState<T extends State = State> = ExcludeSome<StepState<T>, 'repos', string | string[] | Repository>;

export class FetchGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: FetchGitCommandArgs) {
		super(container, 'fetch', 'fetch', 'Fetch', { description: 'fetches changes from one or more remotes' });

		let counter = 0;
		if (args?.state?.repos != null && (!Array.isArray(args.state.repos) || args.state.repos.length !== 0)) {
			counter++;
		}

		this.initialState = {
			counter: counter,
			confirm: args?.confirm,
			...args?.state,
		};
	}

	execute(state: FetchStepState) {
		if (isBranchReference(state.reference)) {
			return state.repos[0].fetch({ branch: state.reference });
		}

		return this.container.git.fetchAll(state.repos, {
			all: state.flags.includes('--all'),
			prune: state.flags.includes('--prune'),
		});
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.commits,
			title: this.title,
		};

		if (state.flags == null) {
			state.flags = [];
		}

		if (state.repos != null && !Array.isArray(state.repos)) {
			state.repos = [state.repos as string];
		}

		let skippedStepOne = false;

		while (this.canStepsContinue(state)) {
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

			if (this.confirm(state.confirm)) {
				const result = yield* this.confirmStep(state as FetchStepState, context);
				if (result === StepResultBreak) {
					// If we skipped the previous step, make sure we back up past it
					if (skippedStepOne) {
						state.counter--;
					}

					continue;
				}

				state.flags = result;
			}

			endSteps(state);
			void this.execute(state as FetchStepState);
		}

		return state.counter < 0 ? StepResultBreak : undefined;
	}

	private async *confirmStep(state: FetchStepState, context: Context): AsyncStepResultGenerator<Flags[]> {
		let lastFetchedOn = '';
		if (state.repos.length === 1) {
			const lastFetched = await state.repos[0].getLastFetched();
			if (lastFetched !== 0) {
				lastFetchedOn = `${pad(GlyphChars.Dot, 2, 2)}Last fetched ${fromNow(new Date(lastFetched))}`;
			}
		}

		let step: QuickPickStep<FlagsQuickPickItem<Flags>>;

		if (state.repos.length === 1 && isBranchReference(state.reference)) {
			step = this.createConfirmStep(
				appendReposToTitle(`Confirm ${context.title}`, state, context, lastFetchedOn),
				[
					createFlagsQuickPickItem<Flags>(state.flags, [], {
						label: this.title,
						detail: `Will fetch ${getReferenceLabel(state.reference)}`,
					}),
				],
			);
		} else {
			const reposToFetch =
				state.repos.length === 1 ? `$(repo) ${state.repos[0].formattedName}` : `${state.repos.length} repos`;

			step = createConfirmStep(
				appendReposToTitle(`Confirm ${this.title}`, state, context, lastFetchedOn),
				[
					createFlagsQuickPickItem<Flags>(state.flags, [], {
						label: this.title,
						detail: `Will fetch ${reposToFetch}`,
					}),
					createFlagsQuickPickItem<Flags>(state.flags, ['--prune'], {
						label: `${this.title} & Prune`,
						description: '--prune',
						detail: `Will fetch and prune ${reposToFetch}`,
					}),
					createFlagsQuickPickItem<Flags>(state.flags, ['--all'], {
						label: `${this.title} All`,
						description: '--all',
						detail: `Will fetch all remotes of ${reposToFetch}`,
					}),
					createFlagsQuickPickItem<Flags>(state.flags, ['--all', '--prune'], {
						label: `${this.title} All & Prune`,
						description: '--all --prune',
						detail: `Will fetch and prune all remotes of ${reposToFetch}`,
					}),
				],
				context,
			);
		}

		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}
}
