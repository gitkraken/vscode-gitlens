import * as nls from 'vscode-nls';
import { GlyphChars } from '../../constants';
import type { Container } from '../../container';
import { isBranch } from '../../git/models/branch';
import type { GitBranchReference } from '../../git/models/reference';
import { GitReference } from '../../git/models/reference';
import type { Repository } from '../../git/models/repository';
import { Directive, DirectiveQuickPickItem } from '../../quickpicks/items/directive';
import { FlagsQuickPickItem } from '../../quickpicks/items/flags';
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
import {
	appendReposToTitle,
	pickRepositoriesStep,
	QuickCommand,
	QuickCommandButtons,
	StepResult,
} from '../quickCommand';

const localize = nls.loadMessageBundle();
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
		super(container, 'pull', localize('label', 'pull'), localize('title', 'Pull'), {
			description: localize(
				'description',
				'fetches and integrates changes from a remote into the current branch',
			),
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
		if (GitReference.isBranch(state.reference)) {
			// Only resort to a branch fetch if the branch isn't the current one
			if (!isBranch(state.reference) || !state.reference.current) {
				const currentBranch = await state.repos[0].getBranch();
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

	private async *confirmStep(state: PullStepState, context: Context): AsyncStepResultGenerator<Flags[]> {
		let step: QuickPickStep<FlagsQuickPickItem<Flags>>;

		if (state.repos.length > 1) {
			step = this.createConfirmStep(
				appendReposToTitle(localize('confirm', 'Confirm {0}', context.title), state, context),
				[
					FlagsQuickPickItem.create<Flags>(state.flags, [], {
						label: this.title,
						detail:
							state.repos.length === 1
								? localize('quickPick.pull.detail.willPullOneRepository', 'Will pull 1 repository')
								: localize(
										'quickPick.pull.detail.willPullRepositories',
										'Will pull {0} repositories',
										state.repos.length,
								  ),
					}),
					FlagsQuickPickItem.create<Flags>(state.flags, ['--rebase'], {
						label: localize('quickPick.rebase.label', '{0} with Rebase', this.title),
						description: '--rebase',
						detail:
							state.repos.length === 1
								? localize(
										'quickPick.rebase.detail.willPullOneRepositoryByRebasing',
										'Will pull 1 repository by rebasing',
										state.repos.length,
								  )
								: localize(
										'quickPick.rebase.detail.willPullRepositoriesByRebasing',
										'Will pull {0} repositories by rebasing',
										state.repos.length,
								  ),
					}),
				],
			);
		} else if (GitReference.isBranch(state.reference)) {
			if (state.reference.remote) {
				step = this.createConfirmStep(
					appendReposToTitle(localize('confirm', 'Confirm {0}', context.title), state, context),
					[],
					DirectiveQuickPickItem.create(Directive.Cancel, true, {
						label: localize('cancel', 'Cancel {0}', this.title),
						detail: localize('cannotPullRemoteBranch', 'Cannot pull a remote branch'),
					}),
				);
			} else {
				const [repo] = state.repos;
				const branch = await repo.getBranch(state.reference.name);

				if (branch?.upstream == null) {
					step = this.createConfirmStep(
						appendReposToTitle(localize('confirm', 'Confirm {0}', context.title), state, context),
						[],
						DirectiveQuickPickItem.create(Directive.Cancel, true, {
							label: localize('cancel', 'Cancel {0}', this.title),
							detail: localize(
								'cannotPullBranchUntilItHasBeenPublished',
								'Cannot pull a branch until it has been published',
							),
						}),
					);
				} else {
					step = this.createConfirmStep(
						appendReposToTitle(localize('confirm', 'Confirm {0}', context.title), state, context),
						[
							FlagsQuickPickItem.create<Flags>(state.flags, [], {
								label: this.title,
								detail: branch.state.behind
									? branch.state.behind === 1
										? localize(
												'quickPick.pull.willPullOneCommitIntoBranch',
												'Will pull 1 commit into {0}',
												GitReference.toString(branch),
										  )
										: localize(
												'quickPick.pull.willPullCommitsIntoBranch',
												'Will pull {0} commits into {1}',
												branch.state.behind,
												GitReference.toString(branch),
										  )
									: localize(
											'quickPick.pull.willPullIntoBranch',
											'Will pull into {0}',
											GitReference.toString(branch),
									  ),
							}),
						],
					);
				}
			}
		} else {
			const [repo] = state.repos;
			const [status, lastFetched] = await Promise.all([repo.getStatus(), repo.getLastFetched()]);

			let lastFetchedOn = '';
			if (lastFetched !== 0) {
				lastFetchedOn = `${pad(GlyphChars.Dot, 2, 2)}${localize(
					'lastFetchedTime',
					'Last fetched {0}',
					fromNow(new Date(lastFetched)),
				)}`;
			}

			step = this.createConfirmStep(
				appendReposToTitle(localize('confirm', 'Confirm {0}', context.title), state, context, lastFetchedOn),
				[
					FlagsQuickPickItem.create<Flags>(state.flags, [], {
						label: this.title,
						detail:
							status?.state.behind != null
								? status.state.behind === 1
									? localize(
											'quickPick.pull.detail.willPullOneCommitIntoRepo',
											'Will pull 1 commit into {0}',
											`$(repo) ${repo.formattedName}`,
									  )
									: localize(
											'quickPick.pull.detail.willPullCommitsIntoRepo',
											'Will pull {0} commits into {1}',
											status.state.behind,
											`$(repo) ${repo.formattedName}`,
									  )
								: localize(
										'quickPick.pull.detail.willPullIntoRepo',
										'Will pull into {0}',
										`$(repo) ${repo.formattedName}`,
								  ),
					}),
					FlagsQuickPickItem.create<Flags>(state.flags, ['--rebase'], {
						label: localize('quickPick.rebase.title', '{0} with Rebase'),
						description: '--rebase',
						detail:
							status?.state.behind != null
								? status.state.behind === 1
									? localize(
											'quickPick.rebase.detail.willPullAndRebaseOneCommitIntoRepo',
											'Will pull and rebase 1 commit into {0}',
											`$(repo) ${repo.formattedName}`,
									  )
									: localize(
											'quickPick.rebase.detail.willPullAndRebaseCommitsIntoRepo',
											'Will pull and rebase {0} commits into {1}',
											status.state.behind,
											`$(repo) ${repo.formattedName}`,
									  )
								: localize(
										'quickPick.rebase.detail.willPullAndRebaseIntoRepo',
										'Will pull and rebase into {0}',
										`$(repo) ${repo.formattedName}`,
								  ),
					}),
				],
				undefined,
				{
					additionalButtons: [QuickCommandButtons.Fetch],
					onDidClickButton: async (quickpick, button) => {
						if (button !== QuickCommandButtons.Fetch || quickpick.busy) return false;

						quickpick.title = `${localize('confirm', 'Confirm {0}', context.title)}${pad(
							GlyphChars.Dot,
							2,
							2,
						)}${localize('fetching', 'Fetching')}${GlyphChars.Ellipsis}`;

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
