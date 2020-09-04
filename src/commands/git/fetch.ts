'use strict';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { Repository } from '../../git/git';
import {
	appendReposToTitle,
	PartialStepState,
	pickRepositoriesStep,
	QuickCommand,
	QuickPickStep,
	StepGenerator,
	StepResult,
	StepResultGenerator,
	StepSelection,
	StepState,
} from '../quickCommand';
import { FlagsQuickPickItem } from '../../quickpicks';
import { Arrays, Dates, Strings } from '../../system';

interface Context {
	repos: Repository[];
	title: string;
}

type Flags = '--all' | '--prune';

interface State {
	repos: string | string[] | Repository | Repository[];
	flags: Flags[];
}

export interface FetchGitCommandArgs {
	readonly command: 'fetch';
	confirm?: boolean;
	state?: Partial<State>;
}

type FetchStepState<T extends State = State> = ExcludeSome<StepState<T>, 'repos', string | string[] | Repository>;

export class FetchGitCommand extends QuickCommand<State> {
	constructor(args?: FetchGitCommandArgs) {
		super('fetch', 'fetch', 'Fetch', { description: 'fetches changes from one or more remotes' });

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
		return Container.git.fetchAll(state.repos, {
			all: state.flags.includes('--all'),
			prune: state.flags.includes('--prune'),
		});
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: [...(await Container.git.getOrderedRepositories())],
			title: this.title,
		};

		if (state.flags == null) {
			state.flags = [];
		}

		if (state.repos != null && !Array.isArray(state.repos)) {
			state.repos = [state.repos as any];
		}

		let skippedStepOne = false;

		while (this.canStepsContinue(state)) {
			context.title = this.title;

			if (
				state.counter < 1 ||
				state.repos == null ||
				state.repos.length === 0 ||
				Arrays.isStringArray(state.repos)
			) {
				skippedStepOne = false;
				if (context.repos.length === 1) {
					if (state.repos == null) {
						skippedStepOne = true;
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
					if (result === StepResult.Break) break;

					state.repos = result;
				}
			}

			if (this.confirm(state.confirm)) {
				const result = yield* this.confirmStep(state as FetchStepState, context);
				if (result === StepResult.Break) {
					// If we skipped the previous step, make sure we back up past it
					if (skippedStepOne) {
						skippedStepOne = false;
						state.counter--;
					}

					continue;
				}

				state.flags = result;
			}

			QuickCommand.endSteps(state);
			void this.execute(state as FetchStepState);
		}

		return state.counter < 0 ? StepResult.Break : undefined;
	}

	private async *confirmStep(state: FetchStepState, context: Context): StepResultGenerator<Flags[]> {
		let lastFetchedOn = '';
		if (state.repos.length === 1) {
			const lastFetched = await state.repos[0].getLastFetched();
			if (lastFetched !== 0) {
				lastFetchedOn = `${Strings.pad(GlyphChars.Dot, 2, 2)}Last fetched ${Dates.getFormatter(
					new Date(lastFetched),
				).fromNow()}`;
			}
		}

		const reposToFetch =
			state.repos.length === 1 ? `$(repo) ${state.repos[0].formattedName}` : `${state.repos.length} repositories`;

		const step: QuickPickStep<FlagsQuickPickItem<Flags>> = QuickCommand.createConfirmStep(
			appendReposToTitle(`Confirm ${this.title}`, state, context, lastFetchedOn),
			[
				FlagsQuickPickItem.create<Flags>(state.flags, [], {
					label: this.title,
					detail: `Will fetch ${reposToFetch}`,
				}),
				FlagsQuickPickItem.create<Flags>(state.flags, ['--prune'], {
					label: `${this.title} & Prune`,
					description: '--prune',
					detail: `Will fetch and prune ${reposToFetch}`,
				}),
				FlagsQuickPickItem.create<Flags>(state.flags, ['--all'], {
					label: `${this.title} All`,
					description: '--all',
					detail: `Will fetch all remotes of ${reposToFetch}`,
				}),
				FlagsQuickPickItem.create<Flags>(state.flags, ['--all', '--prune'], {
					label: `${this.title} All & Prune`,
					description: '--all --prune',
					detail: `Will fetch and prune all remotes of ${reposToFetch}`,
				}),
			],
			context,
		);
		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
	}
}
