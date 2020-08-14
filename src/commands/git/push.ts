'use strict';
import { configuration } from '../../configuration';
import { Container } from '../../container';
import { GitBranchReference, GitReference, Repository } from '../../git/git';
import {
	appendReposToTitle,
	PartialStepState,
	pickRepositoriesStep,
	pickRepositoryStep,
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

type Flags = '--force' | '--set-upstream' | string;

interface State<Repos = string | string[] | Repository | Repository[]> {
	repos: Repos;
	reference?: GitReference;
	flags: Flags[];
}

export interface PushGitCommandArgs {
	readonly command: 'push';
	confirm?: boolean;
	state?: Partial<State>;
}

type PushStepState<T extends State = State> = ExcludeSome<StepState<T>, 'repos', string | string[] | Repository>;

export class PushGitCommand extends QuickCommand<State> {
	constructor(args?: PushGitCommandArgs) {
		super('push', 'push', 'Push', {
			description: 'pushes changes from the current branch to a remote',
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

	execute(state: State<Repository[]>) {
		let setUpstream: { branch: string; remote: string } | undefined;
		if (state.flags.includes('--set-upstream')) {
			const index = state.flags.indexOf('--set-upstream');
			setUpstream = { branch: state.flags[index + 1], remote: state.flags[index + 2] };
		}

		return Container.git.pushAll(state.repos, {
			force: state.flags.includes('--force'),
			setUpstream: setUpstream,
			reference: state.reference,
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

		while (this.canStepsContinue(state)) {
			context.title = this.title;

			if (
				state.counter < 1 ||
				state.repos == null ||
				state.repos.length === 0 ||
				Arrays.isStringArray(state.repos)
			) {
				if (context.repos.length === 1) {
					if (state.repos == null) {
						state.counter++;
					}
					state.repos = [context.repos[0]];
				} else if (state.reference != null) {
					const result = yield* pickRepositoryStep(
						{ ...state, repos: undefined, reference: undefined },
						context,
					);
					// Always break on the first step (so we will go back)
					if (result === StepResult.Break) break;

					state.repos = [result];
				} else {
					const result = yield* pickRepositoriesStep(
						state as ExcludeSome<typeof state, 'repos', string | Repository>,
						context,
					);
					// Always break on the first step (so we will go back)
					if (result === StepResult.Break) break;

					state.repos = result;
				}
			}

			if (this.confirm(state.confirm)) {
				const result = yield* this.confirmStep(state as PushStepState, context);
				if (result === StepResult.Break) {
					// If we skipped the previous step, make sure we back up past it
					if (context.repos.length === 1) {
						state.counter--;
					}

					continue;
				}

				state.flags = result;
			}

			QuickCommand.endSteps(state);
			void this.execute(state as State<Repository[]>);
		}

		return state.counter < 0 ? StepResult.Break : undefined;
	}

	private async *confirmStep(state: PushStepState, context: Context): StepResultGenerator<Flags[]> {
		const useForceWithLease = configuration.getAny<boolean>('git.useForcePushWithLease') ?? false;

		let step: QuickPickStep<FlagsQuickPickItem<Flags>>;
		if (state.repos.length > 1) {
			step = this.createConfirmStep(appendReposToTitle(`Confirm ${context.title}`, state, context), [
				FlagsQuickPickItem.create<Flags>(state.flags, [], {
					label: this.title,
					detail: `Will push ${state.repos.length} repositories`,
				}),
				FlagsQuickPickItem.create<Flags>(state.flags, ['--force'], {
					label: `Force ${this.title}${useForceWithLease ? ' (with lease)' : ''}`,
					description: `--force${useForceWithLease ? '-with-lease' : ''}`,
					detail: `Will force push${useForceWithLease ? ' (with lease)' : ''} ${
						state.repos.length
					} repositories`,
				}),
			]);
		} else {
			const [repo] = state.repos;

			const status = await repo.getStatus();
			if (status?.state.ahead === 0) {
				const items: FlagsQuickPickItem<Flags>[] = [];

				if (state.reference == null && status.upstream == null) {
					const branchRef: GitBranchReference = {
						refType: 'branch',
						name: status.branch,
						ref: status.branch,
						remote: false,
						repoPath: status.repoPath,
					};

					for (const remote of await repo.getRemotes()) {
						items.push(
							FlagsQuickPickItem.create<Flags>(
								state.flags,
								['--set-upstream', status.branch, remote.name],
								{
									label: `${this.title} to ${remote.name}`,
									detail: `Will push ${GitReference.toString(branchRef)} to ${remote.name}`,
								},
							),
						);
					}
				}

				if (items.length) {
					step = this.createConfirmStep(
						appendReposToTitle(`Confirm ${context.title}`, state, context),
						items,
					);
				} else {
					step = this.createConfirmStep(
						appendReposToTitle(`Confirm ${context.title}`, state, context),
						[],
						DirectiveQuickPickItem.create(Directive.Cancel, true, {
							label: `Cancel ${this.title}`,
							detail: 'No commits found to push',
						}),
					);
				}
			} else {
				let lastFetchedOn = '';

				const lastFetched = await repo.getLastFetched();
				if (lastFetched !== 0) {
					lastFetchedOn = `${Strings.pad(GlyphChars.Dot, 2, 2)}Last fetched ${Dates.getFormatter(
						new Date(lastFetched),
					).fromNow()}`;
				}

				let pushDetails;
				if (state.reference != null) {
					pushDetails = status?.state.ahead
						? ` commits up to ${GitReference.toString(state.reference, { label: false })} to $(repo) ${
								repo.formattedName
						  }`
						: ` to ${repo.formattedName}`;
				} else {
					pushDetails = status?.state.ahead
						? ` ${Strings.pluralize('commit', status.state.ahead)} to $(repo) ${repo.formattedName}`
						: ` to ${repo.formattedName}`;
				}

				step = this.createConfirmStep(
					appendReposToTitle(`Confirm ${context.title}`, state, context, lastFetchedOn),
					[
						...(status?.state.behind
							? []
							: [
									FlagsQuickPickItem.create<Flags>(state.flags, [], {
										label: this.title,
										detail: `Will push${pushDetails}`,
									}),
							  ]),
						FlagsQuickPickItem.create<Flags>(state.flags, ['--force'], {
							label: `Force ${this.title}${useForceWithLease ? ' (with lease)' : ''}`,
							description: `--force${useForceWithLease ? '-with-lease' : ''}`,
							detail: `Will force push${useForceWithLease ? ' (with lease)' : ''} ${pushDetails}`,
						}),
					],
					status?.state.behind
						? DirectiveQuickPickItem.create(Directive.Cancel, true, {
								label: `Cancel ${this.title}`,
								detail: `Cannot push; $(repo) ${repo.formattedName} is behind by ${Strings.pluralize(
									'commit',
									status.state.behind,
								)}`,
						  })
						: undefined,
				);

				step.additionalButtons = [QuickCommandButtons.Fetch];
				step.onDidClickButton = async (quickpick, button) => {
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
				};
			}
		}

		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
	}
}
