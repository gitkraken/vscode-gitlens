import { ThemeIcon } from 'vscode';
import { TagError } from '@gitlens/git/errors.js';
import type { GitTagReference } from '@gitlens/git/models/reference.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import { getReferenceLabel } from '@gitlens/git/utils/reference.utils.js';
import { getDefaultRemoteOrOrigin } from '@gitlens/git/utils/remote.utils.js';
import { ensureArray } from '@gitlens/utils/array.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { Container } from '../../../container.js';
import type { GlRepository } from '../../../git/models/repository.js';
import { showGitErrorMessage } from '../../../messages.js';
import type { FlagsQuickPickItem } from '../../../quickpicks/items/flags.js';
import { createFlagsQuickPickItem } from '../../../quickpicks/items/flags.js';
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
import { pickRemoteStep } from '../../quick-wizard/steps/remotes.js';
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
	PickRepo: 'tag-push-pick-repo',
	PickTags: 'tag-push-pick-tags',
	PickRemote: 'tag-push-pick-remote',
	Confirm: 'tag-push-confirm',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];
export type TagPushStepNames = StepNames;

type Context = TagContext<StepNames>;

type Flags = '--force';
interface State<Repo = string | GlRepository, Remote = string | GitRemote> {
	repo: Repo;
	references: GitTagReference | GitTagReference[];
	remote: Remote;
	flags: Flags[];
}
export type TagPushState = State;

export interface TagPushGitCommandArgs {
	readonly command: 'tag-push';
	confirm?: boolean;
	state?: Partial<State>;
}

export class TagPushGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: TagPushGitCommandArgs) {
		super(container, 'tag-push', 'push', 'Push Tags', {
			description: 'pushes the specified tags to a remote',
		});

		this.initialState = { confirm: args?.confirm, ...args?.state };
	}

	override get canSkipConfirm(): boolean {
		return false; // Push always requires confirmation
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

		state.flags ??= [];

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
					placeholder: 'Choose tags to push',
				});
				if (result === StepResultBreak) {
					state.references = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				state.references = result;
			}

			if (steps.isAtStep(Steps.PickRemote) || state.remote == null || typeof state.remote === 'string') {
				const remotes = await state.repo.git.remotes.getRemotes({ sort: true });
				const requestedName = typeof state.remote === 'string' ? state.remote : undefined;
				const resolved = requestedName != null ? remotes.find(r => r.name === requestedName) : undefined;

				// Skip the picker only when there's a single remote and none/a matching one was requested
				if (resolved != null || (requestedName == null && remotes.length === 1)) {
					state.remote = resolved ?? remotes[0];
				} else {
					using step = steps.enterStep(Steps.PickRemote);

					const result = yield* pickRemoteStep(state, context, {
						picked: getDefaultRemoteOrOrigin(remotes)?.name,
						placeholder: 'Choose a remote to push to',
					});
					if (result === StepResultBreak) {
						state.remote = undefined!;
						if (step.goBack() == null) break;
						continue;
					}

					state.remote = result;
				}
			}

			assertStepState<State<GlRepository, GitRemote>>(state);

			if (!steps.isAtStepOrUnset(Steps.Confirm)) continue;

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

			steps.markStepsComplete();

			try {
				await state.repo.git.tags.pushTag?.(
					state.references.map(r => r.ref),
					state.remote.name,
					{ force: state.flags.includes('--force') },
				);
			} catch (ex) {
				Logger.error(ex, context.title);
				void showGitErrorMessage(ex, TagError.is(ex) ? undefined : 'Unable to push tag');
			}
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	private *confirmStep(
		state: StepState<State<GlRepository, GitRemote>>,
		context: TagContext,
	): StepResultGenerator<Flags[]> {
		const step: QuickPickStep<FlagsQuickPickItem<Flags>> = createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			[
				createFlagsQuickPickItem<Flags>(state.flags, [], {
					label: context.title,
					detail: `Will push ${getReferenceLabel(state.references)} to ${state.remote.name}`,
				}),
				createFlagsQuickPickItem<Flags>(state.flags, ['--force'], {
					label: `Force ${context.title}`,
					description: '--force',
					iconPath: new ThemeIcon('warning'),
					detail: `Will force push ${getReferenceLabel(state.references)} to ${
						state.remote.name
					}, overwriting the tag on the remote if it already exists`,
				}),
			],
			context,
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}
}
