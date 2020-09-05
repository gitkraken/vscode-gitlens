'use strict';
import { Container } from '../../container';
import { GitBranchReference, GitReference, Repository } from '../../git/git';
import {
	appendReposToTitle,
	PartialStepState,
	pickRepositoriesStep,
	QuickCommand,
	QuickCommandButtons,
	QuickPickStep,
	StepGenerator,
	StepResult,
	StepResultGenerator,
	StepSelection,
	StepState,
} from '../quickCommand';
import { Directive, DirectiveQuickPickItem, FlagsQuickPickItem } from '../../quickpicks';
import { Arrays, Dates, Strings } from '../../system';
import { GlyphChars } from '../../constants';

interface Context {
	repos: Repository[];
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
	constructor(args?: PullGitCommandArgs) {
		super('pull', 'pull', 'Pull', {
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

	execute(state: PullStepState) {
		if (GitReference.isBranch(state.reference)) {
			return state.repos[0].fetch({ branch: state.reference });
		}

		return Container.git.pullAll(state.repos, { rebase: state.flags.includes('--rebase') });
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
				const result = yield* this.confirmStep(state as PullStepState, context);
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
			void this.execute(state as PullStepState);
		}

		return state.counter < 0 ? StepResult.Break : undefined;
	}

	private async *confirmStep(state: PullStepState, context: Context): StepResultGenerator<Flags[]> {
		let step: QuickPickStep<FlagsQuickPickItem<Flags>>;

		if (state.repos.length > 1) {
			step = this.createConfirmStep(appendReposToTitle(`Confirm ${context.title}`, state, context), [
				FlagsQuickPickItem.create<Flags>(state.flags, [], {
					label: this.title,
					detail: `Will pull ${state.repos.length} repositories`,
				}),
				FlagsQuickPickItem.create<Flags>(state.flags, ['--rebase'], {
					label: `${this.title} with Rebase`,
					description: '--rebase',
					detail: `Will pull ${state.repos.length} repositories by rebasing`,
				}),
			]);
		} else if (GitReference.isBranch(state.reference)) {
			if (state.reference.remote) {
				step = this.createConfirmStep(
					appendReposToTitle(`Confirm ${context.title}`, state, context),
					[],
					DirectiveQuickPickItem.create(Directive.Cancel, true, {
						label: `Cancel ${this.title}`,
						detail: 'Cannot pull a remote branch',
					}),
				);
			} else {
				const [repo] = state.repos;
				const branch = await repo.getBranch(state.reference.name);

				if (branch?.tracking == null) {
					step = this.createConfirmStep(
						appendReposToTitle(`Confirm ${context.title}`, state, context),
						[],
						DirectiveQuickPickItem.create(Directive.Cancel, true, {
							label: `Cancel ${this.title}`,
							detail: 'Cannot pull a branch until it has been published',
						}),
					);
				} else {
					step = this.createConfirmStep(appendReposToTitle(`Confirm ${context.title}`, state, context), [
						FlagsQuickPickItem.create<Flags>(state.flags, [], {
							label: this.title,
							detail: `Will pull${
								branch.state.behind
									? ` ${Strings.pluralize(
											'commit',
											branch.state.behind,
									  )} into ${GitReference.toString(branch)}`
									: ` into ${GitReference.toString(branch)}`
							}`,
						}),
					]);
				}
			}
		} else {
			const [repo] = state.repos;
			const [status, lastFetched] = await Promise.all([repo.getStatus(), repo.getLastFetched()]);

			let lastFetchedOn = '';
			if (lastFetched !== 0) {
				lastFetchedOn = `${Strings.pad(GlyphChars.Dot, 2, 2)}Last fetched ${Dates.getFormatter(
					new Date(lastFetched),
				).fromNow()}`;
			}

			const pullDetails = status?.state.behind
				? ` ${Strings.pluralize('commit', status.state.behind)} into $(repo) ${repo.formattedName}`
				: ` into $(repo) ${repo.formattedName}`;

			step = this.createConfirmStep(
				appendReposToTitle(`Confirm ${context.title}`, state, context, lastFetchedOn),
				[
					FlagsQuickPickItem.create<Flags>(state.flags, [], {
						label: this.title,
						detail: `Will pull${pullDetails}`,
					}),
					FlagsQuickPickItem.create<Flags>(state.flags, ['--rebase'], {
						label: `${this.title} with Rebase`,
						description: '--rebase',
						detail: `Will pull and rebase${pullDetails}`,
					}),
				],
				undefined,
				{
					additionalButtons: [QuickCommandButtons.Fetch],
					onDidClickButton: async (quickpick, button) => {
						if (button !== QuickCommandButtons.Fetch || quickpick.busy) return false;

						quickpick.title = `Confirm ${context.title}${Strings.pad(GlyphChars.Dot, 2, 2)}Fetching${
							GlyphChars.Ellipsis
						}`;

						quickpick.busy = true;
						quickpick.enabled = false;
						try {
							await repo.fetch({ progress: true });
							// Signal that the step should be retried
							return true;
						} finally {
							quickpick.busy = false;
							quickpick.enabled = true;
						}
					},
				},
			);
		}

		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
	}
}
