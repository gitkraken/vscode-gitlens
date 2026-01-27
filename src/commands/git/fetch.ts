import { GlyphChars } from '../../constants.js';
import type { Container } from '../../container.js';
import type { GitBranchReference } from '../../git/models/reference.js';
import type { Repository } from '../../git/models/repository.js';
import { getReferenceLabel, isBranchReference } from '../../git/utils/reference.utils.js';
import type { FlagsQuickPickItem } from '../../quickpicks/items/flags.js';
import { createFlagsQuickPickItem } from '../../quickpicks/items/flags.js';
import { isStringArray } from '../../system/array.js';
import { fromNow } from '../../system/date.js';
import { pad } from '../../system/string.js';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase.js';
import type {
	AsyncStepResultGenerator,
	PartialStepState,
	StepGenerator,
	StepsContext,
	StepSelection,
	StepState,
} from '../quick-wizard/models/steps.js';
import { StepResultBreak } from '../quick-wizard/models/steps.js';
import type { QuickPickStep } from '../quick-wizard/models/steps.quickpick.js';
import { QuickCommand } from '../quick-wizard/quickCommand.js';
import { pickRepositoriesStep } from '../quick-wizard/steps/repositories.js';
import { StepsController } from '../quick-wizard/stepsController.js';
import {
	appendReposToTitle,
	assertStepState,
	canPickStepContinue,
	createConfirmStep,
} from '../quick-wizard/utils/steps.utils.js';

const Steps = {
	PickRepos: 'fetch-pick-repos',
	Confirm: 'fetch-confirm',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];

interface Context extends StepsContext<StepNames> {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	title: string;
}

type Flags = '--all' | '--prune';
interface State<Repos = string | string[] | Repository | Repository[]> {
	repos: Repos;
	reference?: GitBranchReference;
	flags: Flags[];
}

export interface FetchGitCommandArgs {
	readonly command: 'fetch';
	confirm?: boolean;
	state?: Partial<State>;
}

export class FetchGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: FetchGitCommandArgs) {
		super(container, 'fetch', 'fetch', 'Fetch', { description: 'fetches changes from one or more remotes' });

		this.initialState = { confirm: args?.confirm, ...args?.state };
	}

	private execute(state: StepState<State<Repository[]>>) {
		if (isBranchReference(state.reference)) {
			return state.repos[0].fetch({ branch: state.reference });
		}

		return this.container.git.fetchAll(state.repos, {
			all: state.flags.includes('--all'),
			prune: state.flags.includes('--prune'),
		});
	}

	protected createContext(context?: StepsContext<any>): Context {
		return {
			...context,
			container: this.container,
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.commits,
			title: this.title,
		};
	}

	protected async *steps(state: PartialStepState<State>, context?: Context): StepGenerator {
		context ??= this.createContext();
		using steps = new StepsController<StepNames>(context, this);

		state.flags ??= [];

		if (state.repos != null && !Array.isArray(state.repos)) {
			state.repos = typeof state.repos === 'string' ? [state.repos] : [state.repos];
		}

		assertStepState<State<Repository[] | string[]>>(state);

		while (!steps.isComplete) {
			context.title = this.title;

			if (steps.isAtStep(Steps.PickRepos) || !state.repos?.length || isStringArray(state.repos)) {
				// Only show the picker if there are multiple repositories
				if (context.repos.length === 1) {
					state.repos = context.repos;
				} else {
					using step = steps.enterStep(Steps.PickRepos);

					const result = yield* pickRepositoriesStep(state, context, step, {
						excludeWorktrees: true,
						skipIfPossible: !steps.isAtStep(Steps.PickRepos),
					});
					if (result === StepResultBreak) {
						state.repos = undefined!;
						if (step.goBack() == null) break;
						continue;
					}

					state.repos = result;
				}
			}

			assertStepState<State<Repository[]>>(state);

			if (this.confirm(state.confirm)) {
				using step = steps.enterStep(Steps.Confirm);

				const result = yield* this.confirmStep(state, context);
				if (result === StepResultBreak) {
					state.flags = [];
					if (step.goBack() == null) break;
					continue;
				}

				state.flags = result;
			}

			steps.markStepsComplete();
			void this.execute(state);
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	private async *confirmStep(
		state: StepState<State<Repository[]>>,
		context: Context,
	): AsyncStepResultGenerator<Flags[]> {
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
				state.repos.length === 1 ? `$(repo) ${state.repos[0].name}` : `${state.repos.length} repos`;

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
