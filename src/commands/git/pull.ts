import { GlyphChars } from '../../constants.js';
import type { Container } from '../../container.js';
import { isBranch } from '../../git/models/branch.js';
import type { GitBranchReference } from '../../git/models/reference.js';
import type { Repository } from '../../git/models/repository.js';
import { getReferenceLabel, isBranchReference } from '../../git/utils/reference.utils.js';
import { createDirectiveQuickPickItem, Directive } from '../../quickpicks/items/directive.js';
import type { FlagsQuickPickItem } from '../../quickpicks/items/flags.js';
import { createFlagsQuickPickItem } from '../../quickpicks/items/flags.js';
import { isStringArray } from '../../system/array.js';
import { fromNow } from '../../system/date.js';
import { pad, pluralize } from '../../system/string.js';
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
import { FetchQuickInputButton } from '../quick-wizard/quickButtons.js';
import { QuickCommand } from '../quick-wizard/quickCommand.js';
import { pickRepositoriesStep } from '../quick-wizard/steps/repositories.js';
import { StepsController } from '../quick-wizard/stepsController.js';
import { appendReposToTitle, assertStepState, canPickStepContinue } from '../quick-wizard/utils/steps.utils.js';

const Steps = {
	PickRepos: 'pull-pick-repos',
	Confirm: 'pull-confirm',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];

interface Context extends StepsContext<StepNames> {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	title: string;
}

type Flags = '--rebase';
interface State<Repos = string | string[] | Repository | Repository[]> {
	repos: Repos;
	reference?: GitBranchReference;
	flags: Flags[];
}

export interface PullGitCommandArgs {
	readonly command: 'pull';
	confirm?: boolean;
	state?: Partial<State>;
}

export class PullGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: PullGitCommandArgs) {
		super(container, 'pull', 'pull', 'Pull', {
			description: 'fetches and integrates changes from a remote into the current branch',
		});

		this.initialState = { confirm: args?.confirm, ...args?.state };
	}

	private async execute(state: StepState<State<Repository[]>>) {
		if (isBranchReference(state.reference)) {
			// Only resort to a branch fetch if the branch isn't the current one
			if (!isBranch(state.reference) || !state.reference.current) {
				const currentBranch = await state.repos[0].git.branches.getBranch();
				if (currentBranch?.name !== state.reference.name) {
					return state.repos[0].fetch({ branch: state.reference, pull: true });
				}
			}
		}

		return this.container.git.pullAll(state.repos, { rebase: state.flags.includes('--rebase') });
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

			await this.execute(state);
			steps.markStepsComplete();
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	private async *confirmStep(
		state: StepState<State<Repository[]>>,
		context: Context,
	): AsyncStepResultGenerator<Flags[]> {
		let step: QuickPickStep<FlagsQuickPickItem<Flags>>;

		if (state.repos.length > 1) {
			step = this.createConfirmStep(appendReposToTitle(`Confirm ${context.title}`, state, context), [
				createFlagsQuickPickItem<Flags>(state.flags, [], {
					label: this.title,
					detail: `Will pull ${state.repos.length} repos`,
				}),
				createFlagsQuickPickItem<Flags>(state.flags, ['--rebase'], {
					label: `${this.title} with Rebase`,
					description: '--rebase',
					detail: `Will pull ${state.repos.length} repos by rebasing`,
				}),
			]);
		} else if (isBranchReference(state.reference)) {
			if (state.reference.remote) {
				step = this.createConfirmStep(
					appendReposToTitle(`Confirm ${context.title}`, state, context),
					[],
					createDirectiveQuickPickItem(Directive.Cancel, true, {
						label: `Cancel ${this.title}`,
						detail: 'Cannot pull a remote branch',
					}),
				);
			} else {
				const [repo] = state.repos;
				const branch = await repo.git.branches.getBranch(state.reference.name);

				if (branch?.upstream == null) {
					step = this.createConfirmStep(
						appendReposToTitle(`Confirm ${context.title}`, state, context),
						[],
						createDirectiveQuickPickItem(Directive.Cancel, true, {
							label: `Cancel ${this.title}`,
							detail: 'Cannot pull a branch until it has been published',
						}),
					);
				} else {
					step = this.createConfirmStep(appendReposToTitle(`Confirm ${context.title}`, state, context), [
						createFlagsQuickPickItem<Flags>(state.flags, [], {
							label: this.title,
							detail: `Will pull${
								branch.upstream.state.behind
									? ` ${pluralize('commit', branch.upstream.state.behind)} into ${getReferenceLabel(
											branch,
										)}`
									: ` into ${getReferenceLabel(branch)}`
							}`,
						}),
					]);
				}
			}
		} else {
			const [repo] = state.repos;
			const [status, lastFetched] = await Promise.all([repo.git.status.getStatus(), repo.getLastFetched()]);

			let lastFetchedOn = '';
			if (lastFetched !== 0) {
				lastFetchedOn = `${pad(GlyphChars.Dot, 2, 2)}Last fetched ${fromNow(new Date(lastFetched))}`;
			}

			const pullDetails = status?.upstream?.state.behind
				? ` ${pluralize('commit', status.upstream.state.behind)} into $(repo) ${repo.name}`
				: ` into $(repo) ${repo.name}`;

			step = this.createConfirmStep(
				appendReposToTitle(`Confirm ${context.title}`, state, context, lastFetchedOn),
				[
					createFlagsQuickPickItem<Flags>(state.flags, [], {
						label: this.title,
						detail: `Will pull${pullDetails}`,
					}),
					createFlagsQuickPickItem<Flags>(state.flags, ['--rebase'], {
						label: `${this.title} with Rebase`,
						description: '--rebase',
						detail: `Will pull and rebase${pullDetails}`,
					}),
				],
				undefined,
				{
					additionalButtons: [FetchQuickInputButton],
					onDidClickButton: async (quickpick, button) => {
						if (button !== FetchQuickInputButton || quickpick.busy) return false;

						quickpick.title = `Confirm ${context.title}${pad(GlyphChars.Dot, 2, 2)}Fetching${
							GlyphChars.Ellipsis
						}`;

						quickpick.busy = true;
						try {
							await repo.fetch({ progress: true });
							// Signal that the step should be retried
							return true;
						} finally {
							quickpick.busy = false;
						}
					},
				},
			);
		}

		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}
}
