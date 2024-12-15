import { GlyphChars } from '../../constants';
import type { Container } from '../../container';
import { Features } from '../../features';
import { getRemoteNameFromBranchName } from '../../git/models/branch.utils';
import type { GitBranchReference, GitReference } from '../../git/models/reference';
import { getReferenceLabel, isBranchReference } from '../../git/models/reference.utils';
import type { Repository } from '../../git/models/repository';
import { createDirectiveQuickPickItem, Directive } from '../../quickpicks/items/directive';
import type { FlagsQuickPickItem } from '../../quickpicks/items/flags';
import { createFlagsQuickPickItem } from '../../quickpicks/items/flags';
import { isStringArray } from '../../system/array';
import { fromNow } from '../../system/date';
import { pad, pluralize } from '../../system/string';
import { configuration } from '../../system/vscode/configuration';
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
import { appendReposToTitle, pickRepositoriesStep, pickRepositoryStep } from '../quickCommand.steps';

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
				} else if (state.reference != null) {
					const result = yield* pickRepositoryStep(
						{ ...state, repos: undefined, repo: state.reference.repoPath },
						context,
					);
					// Always break on the first step (so we will go back)
					if (result === StepResultBreak) break;

					state.repos = [result];
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
				const result = yield* this.confirmStep(state as PushStepState, context);
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
			void this.execute(state as State<Repository[]>);
		}

		return state.counter < 0 ? StepResultBreak : undefined;
	}

	private async *confirmStep(state: PushStepState, context: Context): AsyncStepResultGenerator<Flags[]> {
		const useForceWithLease = configuration.getCore('git.useForcePushWithLease') ?? true;
		const useForceIfIncludes =
			useForceWithLease &&
			(configuration.getCore('git.useForcePushIfIncludes') ?? true) &&
			(await this.container.git.supports(state.repos[0].uri, Features.ForceIfIncludes));

		let step: QuickPickStep<FlagsQuickPickItem<Flags>>;

		if (state.repos.length > 1) {
			step = this.createConfirmStep(appendReposToTitle(`Confirm ${context.title}`, state, context), [
				createFlagsQuickPickItem<Flags>(state.flags, [], {
					label: this.title,
					detail: `Will push ${state.repos.length} repos`,
				}),
				createFlagsQuickPickItem<Flags>(state.flags, ['--force'], {
					label: `Force ${this.title}${
						useForceIfIncludes ? ' (with lease and if includes)' : useForceWithLease ? ' (with lease)' : ''
					}`,
					description: `--force${
						useForceWithLease ? `-with-lease${useForceIfIncludes ? ' --force-if-includes' : ''}` : ''
					}`,
					detail: `Will force push${
						useForceIfIncludes ? ' (with lease and if includes)' : useForceWithLease ? ' (with lease)' : ''
					} ${state.repos.length} repos`,
				}),
			]);
		} else {
			const [repo] = state.repos;

			const items: FlagsQuickPickItem<Flags>[] = [];

			if (isBranchReference(state.reference)) {
				if (state.reference.remote) {
					step = this.createConfirmStep(
						appendReposToTitle(context.title, state, context),
						[],
						createDirectiveQuickPickItem(Directive.Cancel, true, {
							label: 'OK',
							detail: 'Cannot push a remote branch',
						}),
						{ placeholder: 'Cannot push a remote branch' },
					);
				} else {
					const branch = await repo.git.getBranch(state.reference.name);

					if (branch != null && branch?.upstream == null) {
						for (const remote of await repo.git.getRemotes()) {
							items.push(
								createFlagsQuickPickItem<Flags>(
									state.flags,
									['--set-upstream', remote.name, branch.name],
									{
										label: `Publish ${branch.name} to ${remote.name}`,
										detail: `Will publish ${getReferenceLabel(branch)} to ${remote.name}`,
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
								appendReposToTitle('Publish', state, context),
								[],
								createDirectiveQuickPickItem(Directive.Cancel, true, {
									label: 'OK',
									detail: 'No remotes found',
								}),
								{ placeholder: 'Cannot publish; No remotes found' },
							);
						}
					} else if (branch != null && branch?.state.behind > 0) {
						step = this.createConfirmStep(
							appendReposToTitle(`Confirm ${context.title}`, state, context),
							[
								createFlagsQuickPickItem<Flags>(state.flags, ['--force'], {
									label: `Force ${this.title}${
										useForceIfIncludes
											? ' (with lease and if includes)'
											: useForceWithLease
											  ? ' (with lease)'
											  : ''
									}`,
									description: `--force${
										useForceWithLease
											? `-with-lease${useForceIfIncludes ? ' --force-if-includes' : ''}`
											: ''
									}`,
									detail: `Will force push${
										useForceIfIncludes
											? ' (with lease and if includes)'
											: useForceWithLease
											  ? ' (with lease)'
											  : ''
									} ${branch?.state.ahead ? ` ${pluralize('commit', branch.state.ahead)}` : ''}${
										branch.getRemoteName() ? ` to ${branch.getRemoteName()}` : ''
									}${
										branch != null && branch.state.behind > 0
											? `, overwriting ${pluralize('commit', branch.state.behind)}${
													branch?.getRemoteName() ? ` on ${branch.getRemoteName()}` : ''
											  }`
											: ''
									}`,
								}),
							],
							createDirectiveQuickPickItem(Directive.Cancel, true, {
								label: `Cancel ${this.title}`,
								detail: `Cannot push; ${getReferenceLabel(
									branch,
								)} is behind ${branch.getRemoteName()} by ${pluralize('commit', branch.state.behind)}`,
							}),
						);
					} else if (branch != null && branch?.state.ahead > 0) {
						step = this.createConfirmStep(appendReposToTitle(`Confirm ${context.title}`, state, context), [
							createFlagsQuickPickItem<Flags>(state.flags, [branch.getRemoteName()!], {
								label: this.title,
								detail: `Will push ${pluralize('commit', branch.state.ahead)} from ${getReferenceLabel(
									branch,
								)} to ${branch.getRemoteName()}`,
							}),
						]);
					} else {
						step = this.createConfirmStep(
							appendReposToTitle(context.title, state, context),
							[],
							createDirectiveQuickPickItem(Directive.Cancel, true, {
								label: 'OK',
								detail: 'No commits found to push',
							}),
							{ placeholder: 'Nothing to push; No commits found to push' },
						);
					}
				}
			} else {
				const status = await repo.git.getStatus();

				const branch: GitBranchReference = {
					refType: 'branch',
					name: status?.branch ?? 'HEAD',
					ref: status?.branch ?? 'HEAD',
					remote: false,
					repoPath: repo.path,
				};

				if (status?.state.ahead === 0) {
					if (!isBranchReference(state.reference) && status.upstream == null) {
						let pushDetails;

						if (state.reference != null) {
							pushDetails = ` up to and including ${getReferenceLabel(state.reference, {
								label: false,
							})}`;
						} else {
							state.reference = branch;
							pushDetails = '';
						}

						for (const remote of await repo.git.getRemotes()) {
							items.push(
								createFlagsQuickPickItem<Flags>(
									state.flags,
									['--set-upstream', remote.name, status.branch],
									{
										label: `Publish ${branch.name} to ${remote.name}`,
										detail: `Will publish ${getReferenceLabel(branch)}${pushDetails} to ${
											remote.name
										}`,
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
							appendReposToTitle('Publish', state, context),
							[],
							createDirectiveQuickPickItem(Directive.Cancel, true, {
								label: 'OK',
								detail: 'No remotes found',
							}),
							{ placeholder: 'Cannot publish; No remotes found' },
						);
					} else {
						step = this.createConfirmStep(
							appendReposToTitle(context.title, state, context),
							[],
							createDirectiveQuickPickItem(Directive.Cancel, true, {
								label: 'OK',
								detail: `No commits ahead of ${getRemoteNameFromBranchName(status.upstream?.name)}`,
							}),
							{
								placeholder: `Nothing to push; No commits ahead of ${getRemoteNameFromBranchName(
									status.upstream?.name,
								)}`,
							},
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
								? ` commits up to and including ${getReferenceLabel(state.reference, {
										label: false,
								  })}`
								: ''
						}${status?.upstream ? ` to ${getRemoteNameFromBranchName(status.upstream?.name)}` : ''}`;
					} else {
						pushDetails = `${status?.state.ahead ? ` ${pluralize('commit', status.state.ahead)}` : ''}${
							status?.upstream ? ` to ${getRemoteNameFromBranchName(status.upstream?.name)}` : ''
						}`;
					}

					step = this.createConfirmStep(
						appendReposToTitle(`Confirm ${context.title}`, state, context, lastFetchedOn),
						[
							...(status?.state.behind
								? []
								: [
										createFlagsQuickPickItem<Flags>(state.flags, [], {
											label: this.title,
											detail: `Will push${pushDetails}`,
										}),
								  ]),
							createFlagsQuickPickItem<Flags>(state.flags, ['--force'], {
								label: `Force ${this.title}${
									useForceIfIncludes
										? ' (with lease and if includes)'
										: useForceWithLease
										  ? ' (with lease)'
										  : ''
								}`,
								description: `--force${
									useForceWithLease
										? `-with-lease${useForceIfIncludes ? ' --force-if-includes' : ''}`
										: ''
								}`,
								detail: `Will force push${
									useForceIfIncludes
										? ' (with lease and if includes)'
										: useForceWithLease
										  ? ' (with lease)'
										  : ''
								} ${pushDetails}${
									status != null && status.state.behind > 0
										? `, overwriting ${pluralize('commit', status.state.behind)}${
												status?.upstream
													? ` on ${getRemoteNameFromBranchName(status.upstream?.name)}`
													: ''
										  }`
										: ''
								}`,
							}),
						],
						status?.state.behind
							? createDirectiveQuickPickItem(Directive.Cancel, true, {
									label: `Cancel ${this.title}`,
									detail: `Cannot push; ${getReferenceLabel(branch)} is behind${
										status?.upstream ? ` ${getRemoteNameFromBranchName(status.upstream?.name)}` : ''
									} by ${pluralize('commit', status.state.behind)}`,
							  })
							: undefined,
					);

					step.additionalButtons = [FetchQuickInputButton];
					step.onDidClickButton = async (quickpick, button) => {
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
					};
				}
			}
		}

		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}
}
