import { l10n } from 'vscode';
import { TagError } from '@gitlens/git/errors.js';
import type { GitTagReference } from '@gitlens/git/models/reference.js';
import { getReferenceLabel } from '@gitlens/git/utils/reference.utils.js';
import { ensureArray } from '@gitlens/utils/array.js';
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
import { canSkipRepositoryPick, pickRepositoryStep } from '../../quick-wizard/steps/repositories.js';
import { pickTagsStep } from '../../quick-wizard/steps/tags.js';
import { StepsController } from '../../quick-wizard/stepsController.js';
import {
	appendReposToTitle,
	assertStepState,
	canPickStepContinue,
	createConfirmStep,
} from '../../quick-wizard/utils/steps.utils.js';
import type { TagContext } from '../tag.js';

const Steps = {
	PickRepo: 'tag-delete-pick-repo',
	PickTags: 'tag-delete-pick-tags',
	Confirm: 'tag-delete-confirm',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];
export type TagDeleteStepNames = StepNames;

type Context = TagContext<StepNames>;

interface State<Repo = string | GlRepository> {
	repo: Repo;
	references: GitTagReference | GitTagReference[];
}
export type TagDeleteState = State;

export interface TagDeleteGitCommandArgs {
	readonly command: 'tag-delete';
	confirm?: boolean;
	state?: Partial<State>;
}

export class TagDeleteGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: TagDeleteGitCommandArgs) {
		super(container, 'tag-delete', 'delete', l10n.t('Delete Tags'), {
			description: l10n.t('deletes the specified tags'),
		});

		this.initialState = { confirm: args?.confirm, ...args?.state };
	}

	override get canSkipConfirm(): boolean {
		return false; // Delete always requires confirmation
	}

	protected createContext(context?: StepsContext<any>): Context {
		return {
			...context,
			container: this.container,
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.tags,
			showTags: false,
			title: this.title,
		};
	}

	protected async *steps(state: PartialStepState<State>, context?: Context): StepGenerator {
		context ??= this.createContext();
		using steps = new StepsController<StepNames>(context);

		while (!steps.isComplete) {
			context.title = this.title;

			if (steps.isAtStep(Steps.PickRepo) || state.repo == null || typeof state.repo === 'string') {
				// Skip the picker only when the sole available repo is the one requested
				if (canSkipRepositoryPick(context.repos, state.repo)) {
					[state.repo] = context.repos;
				} else {
					using step = steps.enterStep(Steps.PickRepo);

					const result = yield* pickRepositoryStep(state, context, step, { excludeWorktrees: true });
					if (result === StepResultBreak) {
						state.repo = undefined!;
						if (step.goBack() == null) break;
						continue;
					}

					state.repo = result;
				}
			}

			assertStepState<State<GlRepository>>(state);
			state.references = ensureArray(state.references);

			if (steps.isAtStep(Steps.PickTags) || !state.references?.length) {
				using step = steps.enterStep(Steps.PickTags);

				const result = yield* pickTagsStep(state, context, {
					picked: state.references?.map(r => r.ref),
					placeholder: l10n.t('Choose tags to delete'),
				});
				if (result === StepResultBreak) {
					state.references = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				state.references = result;
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

			for (const { ref } of state.references) {
				try {
					await state.repo.git.tags.deleteTag?.(ref);
				} catch (ex) {
					Logger.error(ex, 'Delete Tags');
					void showGitErrorMessage(ex, TagError.is(ex) ? undefined : l10n.t('Unable to delete tag'));
				}
			}
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	private *confirmStep(state: StepState<State<GlRepository>>, context: TagContext): StepResultGenerator<void> {
		const confirmTitle = l10n.t('Confirm Delete Tags');
		const step: QuickPickStep = createConfirmStep(
			appendReposToTitle(confirmTitle, state, context),
			[{ label: context.title, detail: l10n.t('Will delete {0}', getReferenceLabel(state.references)) }],
			confirmTitle,
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? undefined : StepResultBreak;
	}
}
