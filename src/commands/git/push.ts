import { configuration } from '../../configuration';
import { CoreGitConfiguration, GlyphChars } from '../../constants';
import type { Container } from '../../container';
import { getRemoteNameFromBranchName } from '../../git/models/branch';
import type { GitBranchReference } from '../../git/models/reference';
import { GitReference } from '../../git/models/reference';
import type { Repository } from '../../git/models/repository';
import { Directive, DirectiveQuickPickItem } from '../../quickpicks/items/directive';
import { FlagsQuickPickItem } from '../../quickpicks/items/flags';
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
import {
	appendReposToTitle,
	pickRepositoriesStep,
	pickRepositoryStep,
	QuickCommand,
	QuickCommandButtons,
	StepResult,
} from '../quickCommand';

interface Context {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
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
	constructor(container: Container, args?: PushGitCommandArgs) {
		super(container, 'push', 'push', 'Push', {
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
		const index = state.flags.indexOf('--set-upstream');
		if (index !== -1) {
			if (!GitReference.isBranch(state.reference)) return Promise.resolve();

			return this.container.git.pushAll(state.repos, {
				force: false,
				publish: { remote: state.flags[index + 1] },
				reference: state.reference,
			});
		}

		return this.container.git.pushAll(state.repos, {
			force: state.flags.includes('--force'),
			reference: state.reference,
		});
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: this.container.git.openRepositories,
			associatedView: this.container.commitsView,
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
					state.counter++;

					state.repos = [context.repos[0]];
				} else if (state.reference != null) {
					const result = yield* pickRepositoryStep(
						{ ...state, repos: undefined, repo: state.reference.repoPath },
						context,
					);
					// Always break on the first step (so we will go back)
					if (result === StepResult.Break) break;

					state.repos = [result];
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
				const result = yield* this.confirmStep(state as PushStepState, context);
				if (result === StepResult.Break) {
					// If we skipped the previous step, make sure we back up past it
					if (skippedStepOne) {
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

	private async *confirmStep(state: PushStepState, context: Context): AsyncStepResultGenerator<Flags[]> {
		const useForceWithLease = configuration.getAny<boolean>(CoreGitConfiguration.UseForcePushWithLease) ?? false;

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

			const items: FlagsQuickPickItem<Flags>[] = [];

			if (GitReference.isBranch(state.reference)) {
				if (state.reference.remote) {
					step = this.createConfirmStep(
						appendReposToTitle(`Confirm ${context.title}`, state, context),
						[],
						DirectiveQuickPickItem.create(Directive.Cancel, true, {
							label: `Cancel ${this.title}`,
							detail: 'Cannot push remote branch',
						}),
					);
				} else {
					const branch = await repo.getBranch(state.reference.name);

					if (branch != null && branch?.upstream == null) {
						for (const remote of await repo.getRemotes()) {
							items.push(
								FlagsQuickPickItem.create<Flags>(
									state.flags,
									['--set-upstream', remote.name, branch.name],
									{
										label: `Publish ${branch.name} to ${remote.name}`,
										detail: `Will publish ${GitReference.toString(branch)} to ${remote.name}`,
									},
								),
							);
						}

						if (items.length) {
							step = this.createConfirmStep(
								appendReposToTitle('Confirm Publish', state, context),
								items,
								undefined,
								{ placeholder: 'Confirm Publish' },
							);
						} else {
							step = this.createConfirmStep(
								appendReposToTitle('Confirm Publish', state, context),
								[],
								DirectiveQuickPickItem.create(Directive.Cancel, true, {
									label: 'Cancel Publish',
									detail: 'Cannot publish; No remotes found',
								}),
								{ placeholder: 'Confirm Publish' },
							);
						}
					} else if (branch != null && branch?.state.behind > 0) {
						step = this.createConfirmStep(
							appendReposToTitle(`Confirm ${context.title}`, state, context),
							[
								FlagsQuickPickItem.create<Flags>(state.flags, ['--force'], {
									label: `Force ${this.title}${useForceWithLease ? ' (with lease)' : ''}`,
									description: `--force${useForceWithLease ? '-with-lease' : ''}`,
									detail: `Will force push${useForceWithLease ? ' (with lease)' : ''} ${
										branch?.state.ahead ? ` ${pluralize('commit', branch.state.ahead)}` : ''
									}${branch.getRemoteName() ? ` to ${branch.getRemoteName()}` : ''}${
										branch != null && branch.state.behind > 0
											? `, overwriting ${pluralize('commit', branch.state.behind)}${
													branch?.getRemoteName() ? ` on ${branch.getRemoteName()}` : ''
											  }`
											: ''
									}`,
								}),
							],
							DirectiveQuickPickItem.create(Directive.Cancel, true, {
								label: `Cancel ${this.title}`,
								detail: `Cannot push; ${GitReference.toString(
									branch,
								)} is behind ${branch.getRemoteName()} by ${pluralize('commit', branch.state.behind)}`,
							}),
						);
					} else if (branch != null && branch?.state.ahead > 0) {
						step = this.createConfirmStep(appendReposToTitle(`Confirm ${context.title}`, state, context), [
							FlagsQuickPickItem.create<Flags>(state.flags, [branch.getRemoteName()!], {
								label: this.title,
								detail: `Will push ${pluralize(
									'commit',
									branch.state.ahead,
								)} from ${GitReference.toString(branch)} to ${branch.getRemoteName()}`,
							}),
						]);
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
				}
			} else {
				const status = await repo.getStatus();

				const branch: GitBranchReference = {
					refType: 'branch',
					name: status?.branch ?? 'HEAD',
					ref: status?.branch ?? 'HEAD',
					remote: false,
					repoPath: repo.path,
				};

				if (status?.state.ahead === 0) {
					if (state.reference == null && status.upstream == null) {
						state.reference = branch;

						for (const remote of await repo.getRemotes()) {
							items.push(
								FlagsQuickPickItem.create<Flags>(
									state.flags,
									['--set-upstream', remote.name, status.branch],
									{
										label: `Publish ${branch.name} to ${remote.name}`,
										detail: `Will publish ${GitReference.toString(branch)} to ${remote.name}`,
									},
								),
							);
						}
					}

					if (items.length) {
						step = this.createConfirmStep(
							appendReposToTitle('Confirm Publish', state, context),
							items,
							undefined,
							{ placeholder: 'Confirm Publish' },
						);
					} else if (status.upstream == null) {
						step = this.createConfirmStep(
							appendReposToTitle('Confirm Publish', state, context),
							[],
							DirectiveQuickPickItem.create(Directive.Cancel, true, {
								label: 'Cancel Publish',
								detail: 'Cannot publish; No remotes found',
							}),
							{ placeholder: 'Confirm Publish' },
						);
					} else {
						step = this.createConfirmStep(
							appendReposToTitle('Confirm Push', state, context),
							[],
							DirectiveQuickPickItem.create(Directive.Cancel, true, {
								label: `Cancel ${this.title}`,
								detail: `Cannot push; No commits ahead of ${getRemoteNameFromBranchName(
									status.upstream,
								)}`,
							}),
						);
					}
				} else {
					let lastFetchedOn = '';

					const lastFetched = await repo.getLastFetched();
					if (lastFetched !== 0) {
						lastFetchedOn = `${pad(GlyphChars.Dot, 2, 2)}Last fetched ${fromNow(new Date(lastFetched))}`;
					}

					let pushDetails;
					if (state.reference != null) {
						pushDetails = `${
							status?.state.ahead
								? ` commits up to and including ${GitReference.toString(state.reference, {
										label: false,
								  })}`
								: ''
						}${status?.upstream ? ` to ${getRemoteNameFromBranchName(status.upstream)}` : ''}`;
					} else {
						pushDetails = `${status?.state.ahead ? ` ${pluralize('commit', status.state.ahead)}` : ''}${
							status?.upstream ? ` to ${getRemoteNameFromBranchName(status.upstream)}` : ''
						}`;
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
								detail: `Will force push${useForceWithLease ? ' (with lease)' : ''} ${pushDetails}${
									status != null && status.state.behind > 0
										? `, overwriting ${pluralize('commit', status.state.behind)}${
												status?.upstream
													? ` on ${getRemoteNameFromBranchName(status.upstream)}`
													: ''
										  }`
										: ''
								}`,
							}),
						],
						status?.state.behind
							? DirectiveQuickPickItem.create(Directive.Cancel, true, {
									label: `Cancel ${this.title}`,
									detail: `Cannot push; ${GitReference.toString(branch)} is behind${
										status?.upstream ? ` ${getRemoteNameFromBranchName(status.upstream)}` : ''
									} by ${pluralize('commit', status.state.behind)}`,
							  })
							: undefined,
					);

					step.additionalButtons = [QuickCommandButtons.Fetch];
					step.onDidClickButton = async (quickpick, button) => {
						if (button !== QuickCommandButtons.Fetch || quickpick.busy) return false;

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
					};
				}
			}
		}

		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
	}
}
