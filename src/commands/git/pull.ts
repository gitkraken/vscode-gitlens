import { GlyphChars } from '../../constants';
import type { Container } from '../../container';
import { isBranch } from '../../git/models/branch';
import type { GitBranchReference } from '../../git/models/reference';
import { getReferenceLabel, isBranchReference } from '../../git/models/reference.utils';
import type { Repository } from '../../git/models/repository';
import { createDirectiveQuickPickItem, Directive } from '../../quickpicks/items/directive';
import type { FlagsQuickPickItem } from '../../quickpicks/items/flags';
import { createFlagsQuickPickItem } from '../../quickpicks/items/flags';
import { isStringArray } from '../../system/array';
import { fromNow } from '../../system/date';
import { pad, pluralize } from '../../system/string';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase';
import type {
	AsyncStepResultGenerator,
	PartialStepState,
	QuickPickStep,
	StepGenerator,
	StepSelection,
	StepState,
} from '../quickCommand';
import { canPickStepContinue, endSteps, QuickCommand, StepResultBreak } from '../quickCommand';
import { FetchQuickInputButton } from '../quickCommand.buttons';
import { appendReposToTitle, pickRepositoriesStep } from '../quickCommand.steps';

interface Context {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	title: string;
}

type Flags = '--rebase';

interface State {
	repos: string | string[] | Repository | Repository[];
	reference?: GitBranchReference;
	flags: Flags[];
}

export interface PullGitCommandArgs {
	readonly command: 'pull';
	confirm?: boolean;
	state?: Partial<State>;
}

type PullStepState<T extends State = State> = ExcludeSome<StepState<T>, 'repos', string | string[] | Repository>;

export class PullGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: PullGitCommandArgs) {
		super(container, 'pull', 'pull', 'Pull', {
			description: 'fetches and integrates changes from a remote into the current branch',
		});

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

	async execute(state: PullStepState) {
		if (isBranchReference(state.reference)) {
			// Only resort to a branch fetch if the branch isn't the current one
			if (!isBranch(state.reference) || !state.reference.current) {
				const currentBranch = await state.repos[0].git.getBranch();
				if (currentBranch?.name !== state.reference.name) {
					return state.repos[0].fetch({ branch: state.reference, pull: true });
				}
			}
		}

		return this.container.git.pullAll(state.repos, { rebase: state.flags.includes('--rebase') });
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
				const result = yield* this.confirmStep(state as PullStepState, context);
				if (result === StepResultBreak) {
					// If we skipped the previous step, make sure we back up past it
					if (skippedStepOne) {
						state.counter--;
					}

					continue;
				}

				state.flags = result;
			}

			await this.execute(state as PullStepState);
			endSteps(state);
		}

		return state.counter < 0 ? StepResultBreak : undefined;
	}

	private async *confirmStep(state: PullStepState, context: Context): AsyncStepResultGenerator<Flags[]> {
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
				const branch = await repo.git.getBranch(state.reference.name);

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
								branch.state.behind
									? ` ${pluralize('commit', branch.state.behind)} into ${getReferenceLabel(branch)}`
									: ` into ${getReferenceLabel(branch)}`
							}`,
						}),
					]);
				}
			}
		} else {
			const [repo] = state.repos;
			const [status, lastFetched] = await Promise.all([repo.git.getStatus(), repo.getLastFetched()]);

			let lastFetchedOn = '';
			if (lastFetched !== 0) {
				lastFetchedOn = `${pad(GlyphChars.Dot, 2, 2)}Last fetched ${fromNow(new Date(lastFetched))}`;
			}

			const pullDetails =
				status?.state.behind != null
					? ` ${pluralize('commit', status.state.behind)} into $(repo) ${repo.formattedName}`
					: ` into $(repo) ${repo.formattedName}`;

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
