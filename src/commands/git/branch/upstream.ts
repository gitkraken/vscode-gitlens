import { l10n, ThemeIcon } from 'vscode';
import { BranchError } from '@gitlens/git/errors.js';
import type { GitBranchReference } from '@gitlens/git/models/reference.js';
import { getReferenceLabel } from '@gitlens/git/utils/reference.utils.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { Container } from '../../../container.js';
import type { GlRepository } from '../../../git/models/repository.js';
import { showGitErrorMessage } from '../../../messages.js';
import type {
	PartialStepState,
	StepGenerator,
	StepResultGenerator,
	StepsContext,
	StepSelection,
	StepState,
} from '../../quick-wizard/models/steps.js';
import { StepResultBreak } from '../../quick-wizard/models/steps.js';
import type { QuickPickStep } from '../../quick-wizard/models/steps.quickpick.js';
import { QuickCommand } from '../../quick-wizard/quickCommand.js';
import { pickBranchStep, pickOrResetBranchStep } from '../../quick-wizard/steps/branches.js';
import { canSkipRepositoryPick, pickRepositoryStep } from '../../quick-wizard/steps/repositories.js';
import { StepsController } from '../../quick-wizard/stepsController.js';
import {
	appendReposToTitle,
	assertStepState,
	canPickStepContinue,
	createConfirmStep,
} from '../../quick-wizard/utils/steps.utils.js';
import type { BranchContext } from '../branch.js';

const Steps = {
	PickRepo: 'branch-upstream-pick-repo',
	PickBranch: 'branch-upstream-pick-branch',
	PickRemoteBranch: 'branch-upstream-pick-remote-branch',
	Confirm: 'branch-upstream-confirm',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];
export type BranchUpstreamStepNames = StepNames;

type Context = BranchContext<StepNames>;

interface State<Repo = string | GlRepository> {
	repo: Repo;
	reference: GitBranchReference;
	/** Specifies the desired upstream; use `null` to unset */
	upstream?: GitBranchReference | null;
}
export type BranchUpstreamState = State;

export interface BranchUpstreamGitCommandArgs {
	readonly command: 'branch-upstream';
	confirm?: boolean;
	state?: Partial<State>;
}

export class BranchUpstreamGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: BranchUpstreamGitCommandArgs) {
		super(container, 'branch-upstream', 'upstream', l10n.t('Change Upstream'), {
			description: l10n.t('manages upstream tracking for a branch'),
		});

		this.initialState = { confirm: args?.confirm, ...args?.state };
	}

	protected createContext(context?: StepsContext<any>): Context {
		return {
			...context,
			container: this.container,
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.branches,
			showTags: false,
			title: this.title,
		};
	}

	protected async *steps(state: PartialStepState<State>, context?: Context): StepGenerator {
		context ??= this.createContext();
		using steps = new StepsController<StepNames>(context, this);

		while (!steps.isComplete) {
			context.title = this.title;

			if (steps.isAtStep(Steps.PickRepo) || state.repo == null || typeof state.repo === 'string') {
				// Skip the picker only when the sole available repo is the one requested
				if (canSkipRepositoryPick(context.repos, state.repo)) {
					[state.repo] = context.repos;
				} else {
					using step = steps.enterStep(Steps.PickRepo);

					const result = yield* pickRepositoryStep(state, context, step);
					if (result === StepResultBreak) {
						state.repo = undefined!;
						if (step.goBack() == null) break;
						continue;
					}

					state.repo = result;
				}
			}

			assertStepState<State<GlRepository>>(state);

			if (steps.isAtStep(Steps.PickBranch) || state.reference == null) {
				using step = steps.enterStep(Steps.PickBranch);

				const result = yield* pickBranchStep(state, context, {
					filter: b => !b.remote,
					picked: state.reference?.ref,
					placeholder: l10n.t('Choose a branch to change its upstream tracking'),
				});
				if (result === StepResultBreak) {
					state.reference = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				state.reference = result;
			}

			if (steps.isAtStep(Steps.PickRemoteBranch) || state.upstream === undefined) {
				using step = steps.enterStep(Steps.PickRemoteBranch);

				const result = yield* pickOrResetBranchStep(state, context, {
					filter: b => b.remote,
					placeholder: l10n.t('Choose an upstream branch to track'),
					picked: state.upstream?.ref,
					reset:
						state.reference.upstream != null
							? {
									label: l10n.t('Unset Upstream'),
									description: l10n.t('Removes any upstream tracking'),
									button: { icon: new ThemeIcon('discard'), tooltip: l10n.t('Unset Upstream') },
								}
							: undefined,
				});
				if (result === StepResultBreak) {
					state.upstream = undefined;
					if (step.goBack() == null) break;
					continue;
				}

				state.upstream = result ?? null;
			}

			if (!steps.isAtStepOrUnset(Steps.Confirm)) continue;

			{
				using step = steps.enterStep(Steps.Confirm);

				const result = yield* this.confirmStep(state, context);
				if (result === StepResultBreak) {
					if (step.goBack() == null) break;
					continue;
				}
			}

			steps.markStepsComplete();

			try {
				await state.repo.git.branches.setUpstreamBranch?.(
					state.reference.name,
					state.upstream?.name ?? undefined,
				);
			} catch (ex) {
				Logger.error(ex, 'Change Upstream');
				void showGitErrorMessage(
					ex,
					BranchError.is(ex) ? undefined : l10n.t('Unable to manage upstream tracking'),
				);
			}
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	private *confirmStep(state: StepState<State<GlRepository>>, context: Context): StepResultGenerator<void> {
		let confirmTitle: string;
		let title: string;
		let detail: string;
		if (state.upstream == null) {
			confirmTitle = l10n.t('Confirm Unset Upstream');
			title = l10n.t('Unset Upstream');
			detail = l10n.t('Will remove the upstream tracking from {0}', getReferenceLabel(state.reference));
		} else if (state.reference.upstream == null) {
			confirmTitle = l10n.t('Confirm Set Upstream');
			title = l10n.t('Set Upstream');
			detail = l10n.t(
				'Will set the upstream tracking for {0} to {1}',
				getReferenceLabel(state.reference),
				getReferenceLabel(state.upstream, { label: false }),
			);
		} else {
			confirmTitle = l10n.t('Confirm Change Upstream');
			title = l10n.t('Change Upstream');
			detail = l10n.t(
				'Will change the upstream tracking for {0} to {1}',
				getReferenceLabel(state.reference),
				getReferenceLabel(state.upstream, { label: false }),
			);
		}

		const step: QuickPickStep = createConfirmStep(
			appendReposToTitle(confirmTitle, state, context),
			[{ label: title, detail: detail }],
			l10n.t('Confirm Change Upstream'),
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? undefined : StepResultBreak;
	}
}
