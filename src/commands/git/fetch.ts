import type { GitBranchReference } from '@gitlens/git/models/reference.js';
import { getRemoteNameFromBranchName } from '@gitlens/git/utils/branch.utils.js';
import { parseGitBoolean } from '@gitlens/git/utils/config.utils.js';
import { getReferenceLabel, isBranchReference } from '@gitlens/git/utils/reference.utils.js';
import { isStringArray } from '@gitlens/utils/array.js';
import { fromNow } from '@gitlens/utils/date.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import { pad } from '@gitlens/utils/string.js';
import { GlyphChars } from '../../constants.js';
import type { Container } from '../../container.js';
import type { GlRepository } from '../../git/models/repository.js';
import { createQuickPickSeparator } from '../../quickpicks/items/common.js';
import type { DirectiveQuickPickItem } from '../../quickpicks/items/directive.js';
import { createConfirmToggleQuickPickItem } from '../../quickpicks/items/directive.js';
import type { FlagsQuickPickItem } from '../../quickpicks/items/flags.js';
import { createFlagsQuickPickItem } from '../../quickpicks/items/flags.js';
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
import { canSkipRepositoriesPick, pickRepositoriesStep } from '../quick-wizard/steps/repositories.js';
import { StepsController } from '../quick-wizard/stepsController.js';
import {
	appendReposToTitle,
	assertStepState,
	canPickStepContinue,
	refreshConfirmStepItems,
} from '../quick-wizard/utils/steps.utils.js';

const Steps = {
	PickRepos: 'fetch-pick-repos',
	Confirm: 'fetch-confirm',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];

interface Context extends StepsContext<StepNames> {
	repos: GlRepository[];
	associatedView: ViewsWithRepositoryFolders;
	title: string;
}

type Flags = '--all' | '--prune';
interface State<Repos = string | string[] | GlRepository | GlRepository[]> {
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

	private execute(state: StepState<State<GlRepository[]>>) {
		if (isBranchReference(state.reference)) {
			return state.repos[0].git.fetch({ branch: state.reference });
		}

		return this.container.git.fetchAll(state.repos, {
			all: state.flags.includes('--all'),
			prune: state.flags.includes('--prune'),
		});
	}

	protected override get supportsSkipConfirmToggle(): boolean {
		return true;
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

		assertStepState<State<GlRepository[] | string[]>>(state);

		while (!steps.isComplete) {
			context.title = this.title;

			if (steps.isAtStep(Steps.PickRepos) || !state.repos?.length || isStringArray(state.repos)) {
				// Skip the picker only when the sole available repo is the one requested
				if (canSkipRepositoriesPick(context.repos, state.repos)) {
					state.repos = context.repos;
				} else {
					using step = steps.enterStep(Steps.PickRepos);

					const result = yield* pickRepositoriesStep(state, context, step, {
						excludeWorktrees: true,
						skipIfPossible: true,
					});
					if (result === StepResultBreak) {
						state.repos = undefined!;
						if (step.goBack() == null) break;
						continue;
					}

					state.repos = result;
				}
			}

			assertStepState<State<GlRepository[]>>(state);

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
		state: StepState<State<GlRepository[]>>,
		context: Context,
	): AsyncStepResultGenerator<Flags[]> {
		let lastFetchedOn = '';
		if (state.repos.length === 1) {
			const lastFetched = await state.repos[0].getLastFetched();
			if (lastFetched !== 0) {
				lastFetchedOn = `${pad(GlyphChars.Dot, 2, 2)}Last fetched ${fromNow(new Date(lastFetched))}`;
			}
		}

		let step: QuickPickStep<FlagsQuickPickItem<Flags> | DirectiveQuickPickItem>;

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

			// A seeded wizard flag wins; otherwise, for a single repo in scope, the `fetch.prune` config
			// decides, so the toggle reflects what git will actually do if left untouched. Multi-repo
			// fetches skip the config read (repos can disagree) and default the toggle unchecked.
			let prune = state.flags.includes('--prune');
			// Name the remote a plain fetch will actually hit, so the row contrasts meaningfully with
			// Fetch All Remotes; multi-repo fetches keep the generic sentence
			let remoteName: string | undefined;
			if (state.repos.length === 1) {
				const [repo] = state.repos;
				const [pruneResult, branchResult] = await Promise.allSettled([
					prune ? undefined : repo.git.config.getConfig?.('fetch.prune'),
					repo.git.branches.getBranch(),
				]);
				if (!prune) {
					prune = parseGitBoolean(getSettledValue(pruneResult)) ?? false;
				}

				const upstream = getSettledValue(branchResult)?.upstream?.name;
				remoteName = upstream != null ? getRemoteNameFromBranchName(upstream) : 'origin';
			}

			// Folds the live toggle value into each item's flags and detail — the accepted item's flags are
			// the whole contract with `execute()` — so the list says what will actually happen.
			const buildItems = (): FlagsQuickPickItem<Flags>[] => {
				const pruneClause = prune ? ', pruning stale remote-tracking branches' : '';
				return [
					createFlagsQuickPickItem<Flags>(state.flags, prune ? ['--prune'] : [], {
						label: this.title,
						detail: `Will fetch ${remoteName != null ? `${remoteName} of ` : ''}${reposToFetch}${pruneClause}`,
						picked: !state.flags.includes('--all'),
					}),
					createFlagsQuickPickItem<Flags>(state.flags, prune ? ['--all', '--prune'] : ['--all'], {
						label: `${this.title} All Remotes`,
						description: '--all',
						detail: `Will fetch all remotes of ${reposToFetch}${pruneClause}`,
						picked: state.flags.includes('--all'),
					}),
				];
			};

			let items = buildItems();

			// Takes the toggle row rather than closing over it so this can be declared before the toggle
			// itself, which needs `buildRows` in its handler.
			const buildRows = (
				toggle: DirectiveQuickPickItem,
			): (FlagsQuickPickItem<Flags> | DirectiveQuickPickItem)[] => [
				...items,
				createQuickPickSeparator('Options'),
				toggle,
			];

			const pruneToggle = createConfirmToggleQuickPickItem({
				label: 'Prune',
				description: '--prune',
				detail: 'Also remove remote-tracking branches that no longer exist on the remote',
				checked: prune,
				onDidChange: item => {
					prune = item.checked;
					items = buildItems();
					refreshConfirmStepItems(step, buildRows(item));
				},
			});

			step = this.createConfirmStep(
				appendReposToTitle(`Confirm ${this.title}`, state, context, lastFetchedOn),
				buildRows(pruneToggle),
			);
		}

		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}
}
