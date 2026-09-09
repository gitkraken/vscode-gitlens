import { l10n } from 'vscode';
import { GitBranch } from '@gitlens/git/models/branch.js';
import type { GitBranchReference } from '@gitlens/git/models/reference.js';
import { getReferenceLabel, isBranchReference } from '@gitlens/git/utils/reference.utils.js';
import { isStringArray } from '@gitlens/utils/array.js';
import { fromNow } from '@gitlens/utils/date.js';
import { formatPlural } from '@gitlens/utils/plural.js';
import { pad } from '@gitlens/utils/string.js';
import { GlyphChars } from '../../constants.js';
import type { Container } from '../../container.js';
import type { GlRepository } from '../../git/models/repository.js';
import { createDirectiveQuickPickItem, Directive } from '../../quickpicks/items/directive.js';
import type { FlagsQuickPickItem } from '../../quickpicks/items/flags.js';
import { createFlagsQuickPickItem } from '../../quickpicks/items/flags.js';
import { supportedInVSCodeVersion } from '../../system/-webview/vscode.js';
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
import { canSkipRepositoriesPick, pickRepositoriesStep } from '../quick-wizard/steps/repositories.js';
import { StepsController } from '../quick-wizard/stepsController.js';
import { appendReposToTitle, assertStepState, canPickStepContinue } from '../quick-wizard/utils/steps.utils.js';

const Steps = {
	PickRepos: 'pull-pick-repos',
	Confirm: 'pull-confirm',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];

interface Context extends StepsContext<StepNames> {
	repos: GlRepository[];
	associatedView: ViewsWithRepositoryFolders;
	title: string;
}

type Flags = '--rebase';
interface State<Repos = string | string[] | GlRepository | GlRepository[]> {
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
		super(container, 'pull', 'pull', l10n.t('Pull'), {
			description: l10n.t('fetches and integrates changes from a remote into the current branch'),
		});

		this.initialState = { confirm: args?.confirm, ...args?.state };
	}

	private async execute(state: StepState<State<GlRepository[]>>) {
		if (isBranchReference(state.reference)) {
			// Only resort to a branch fetch if the branch isn't the current one
			if (!GitBranch.is(state.reference) || !state.reference.current) {
				const currentBranch = await state.repos[0].git.branches.getBranch();
				if (currentBranch?.name !== state.reference.name) {
					return state.repos[0].git.fetch({ branch: state.reference, pull: true });
				}
			}
		}

		return this.container.git.pullAll(state.repos, { rebase: state.flags.includes('--rebase') });
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

			await this.execute(state);
			steps.markStepsComplete();
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	private async *confirmStep(
		state: StepState<State<GlRepository[]>>,
		context: Context,
	): AsyncStepResultGenerator<Flags[]> {
		let step: QuickPickStep<FlagsQuickPickItem<Flags>>;

		if (state.repos.length > 1) {
			step = this.createConfirmStep(
				appendReposToTitle(l10n.t('Confirm Pull'), state, context),
				[
					createFlagsQuickPickItem<Flags>(state.flags, [], {
						label: this.title,
						detail: l10n.t('Will pull {0} repos', state.repos.length),
					}),
					createFlagsQuickPickItem<Flags>(state.flags, ['--rebase'], {
						label: l10n.t('Pull with Rebase'),
						description: '--rebase',
						detail: l10n.t('Will pull {0} repos by rebasing', state.repos.length),
					}),
				],
				l10n.t('Confirm Pull'),
			);
		} else if (isBranchReference(state.reference)) {
			if (state.reference.remote) {
				step = this.createConfirmStep(
					appendReposToTitle(l10n.t('Confirm Pull'), state, context),
					[],
					l10n.t('Confirm Pull'),
					createDirectiveQuickPickItem(Directive.Cancel, true, {
						label: l10n.t('Cancel Pull'),
						detail: l10n.t('Cannot pull a remote branch'),
					}),
				);
			} else {
				const [repo] = state.repos;
				const branch = await repo.git.branches.getBranch(state.reference.name);

				if (branch?.upstream == null) {
					step = this.createConfirmStep(
						appendReposToTitle(l10n.t('Confirm Pull'), state, context),
						[],
						l10n.t('Confirm Pull'),
						createDirectiveQuickPickItem(Directive.Cancel, true, {
							label: l10n.t('Cancel Pull'),
							detail: l10n.t('Cannot pull a branch until it has been published'),
						}),
					);
				} else {
					step = this.createConfirmStep(
						appendReposToTitle(l10n.t('Confirm Pull'), state, context),
						[
							createFlagsQuickPickItem<Flags>(state.flags, [], {
								label: this.title,
								detail:
									branch.upstream.state.behind === 0
										? l10n.t('Will pull into {0}', getReferenceLabel(branch))
										: formatPlural(
												l10n.t(
													'{0, plural, one{Will pull {0} commit into {1}} other{Will pull {0} commits into {1}}}',
												),
												[branch.upstream.state.behind, getReferenceLabel(branch)],
											),
							}),
						],
						l10n.t('Confirm Pull'),
					);
				}
			}
		} else {
			const [repo] = state.repos;
			const [status, lastFetched] = await Promise.all([repo.git.status.getStatus(), repo.getLastFetched()]);

			// On 1.108+ the last-fetched note renders in the message slot between the input and the list;
			// below that it stays a title suffix
			const supportsPrompt = supportedInVSCodeVersion('quickpick-prompt');
			let lastFetchedOn = '';
			let lastFetchedPrompt: string | undefined;
			if (lastFetched !== 0) {
				if (supportsPrompt) {
					lastFetchedPrompt = l10n.t('Last fetched {0}', fromNow(new Date(lastFetched)));
				} else {
					lastFetchedOn = l10n.t(
						'{0}Last fetched {1}',
						pad(GlyphChars.Dot, 2, 2),
						fromNow(new Date(lastFetched)),
					);
				}
			}

			const pullDetails =
				status?.upstream?.state.behind == null || status.upstream.state.behind === 0
					? {
							pull: l10n.t('Will pull into $(repo) {0}', repo.name),
							pullRebase: l10n.t('Will pull and rebase into $(repo) {0}', repo.name),
						}
					: {
							pull: formatPlural(
								l10n.t(
									'{0, plural, one{Will pull {0} commit into $(repo) {1}} other{Will pull {0} commits into $(repo) {1}}}',
								),
								[status.upstream.state.behind, repo.name],
							),
							pullRebase: formatPlural(
								l10n.t(
									'{0, plural, one{Will pull and rebase {0} commit into $(repo) {1}} other{Will pull and rebase {0} commits into $(repo) {1}}}',
								),
								[status.upstream.state.behind, repo.name],
							),
						};

			step = this.createConfirmStep(
				appendReposToTitle(l10n.t('Confirm Pull'), state, context, lastFetchedOn),
				[
					createFlagsQuickPickItem<Flags>(state.flags, [], {
						label: this.title,
						detail: pullDetails.pull,
					}),
					createFlagsQuickPickItem<Flags>(state.flags, ['--rebase'], {
						label: l10n.t('Pull with Rebase'),
						description: '--rebase',
						detail: pullDetails.pullRebase,
					}),
				],
				l10n.t('Confirm Pull'),
				undefined,
				{
					prompt: lastFetchedPrompt,
					additionalButtons: [FetchQuickInputButton],
					onDidClickButton: async (quickpick, button) => {
						if (button !== FetchQuickInputButton || quickpick.busy) return false;

						quickpick.title = l10n.t(
							'Confirm Pull{0}Fetching{1}',
							pad(GlyphChars.Dot, 2, 2),
							GlyphChars.Ellipsis,
						);

						quickpick.busy = true;
						try {
							await repo.git.fetch({ progress: true });
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
