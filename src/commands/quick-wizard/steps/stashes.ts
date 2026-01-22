import { showStashInDetailsView } from '../../../git/actions/stash.js';
import type { GitStashCommit } from '../../../git/models/commit.js';
import type { Repository } from '../../../git/models/repository.js';
import type { GitStash } from '../../../git/models/stash.js';
import { createDirectiveQuickPickItem, Directive } from '../../../quickpicks/items/directive.js';
import type { CommitQuickPickItem } from '../../../quickpicks/items/gitWizard.js';
import { createStashQuickPickItem } from '../../../quickpicks/items/gitWizard.js';
import { map } from '../../../system/iterable.js';
import type { PartialStepState, StepResultGenerator, StepsContext, StepSelection } from '../models/steps.js';
import { StepResultBreak } from '../models/steps.js';
import { ShowDetailsViewQuickInputButton } from '../quickButtons.js';
import { appendReposToTitle, canPickStepContinue, createPickStep } from '../utils/steps.utils.js';

export function* pickStashStep<
	State extends PartialStepState & { repo: Repository },
	Context extends StepsContext<any> & { repos: Repository[] },
>(
	state: State,
	context: Context,
	options: {
		ignoreFocusOut?: boolean;
		stash: GitStash | undefined;
		picked: string | string[] | undefined;
		placeholder: string | ((context: Context, stash: GitStash | undefined) => string);
		title?: string;
	},
): StepResultGenerator<GitStashCommit> {
	const step = createPickStep<CommitQuickPickItem<GitStashCommit>>({
		title: appendReposToTitle(options.title ?? context.title, state, context),
		placeholder:
			typeof options.placeholder === 'string' ? options.placeholder : options.placeholder(context, options.stash),
		ignoreFocusOut: options.ignoreFocusOut,
		matchOnDescription: true,
		matchOnDetail: true,
		canGoBack: context.steps?.canGoBack,
		items: !options.stash?.stashes.size
			? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
			: [
					...map(options.stash.stashes.values(), stash =>
						createStashQuickPickItem(
							stash,
							options.picked != null &&
								(typeof options.picked === 'string'
									? stash.ref === options.picked
									: options.picked.includes(stash.ref)),
							{
								buttons: [ShowDetailsViewQuickInputButton],
								compact: true,
								icon: true,
							},
						),
					),
				],
		onDidClickItemButton: (_quickpick, button, { item }) => {
			if (button === ShowDetailsViewQuickInputButton) {
				void showStashInDetailsView(item, { pin: false, preserveFocus: true });
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (_quickpick, _key, { item }) => {
			await showStashInDetailsView(item, { pin: false, preserveFocus: true });
		},
	});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
}

export function* pickStashesStep<
	State extends PartialStepState & { repo: Repository },
	Context extends StepsContext<any> & { repos: Repository[] },
>(
	state: State,
	context: Context,
	options: {
		ignoreFocusOut?: boolean;
		stash: GitStash | undefined;
		picked: string | string[] | undefined;
		placeholder: string | ((context: Context, stash: GitStash | undefined) => string);
		title?: string;
	},
): StepResultGenerator<GitStashCommit[]> {
	const step = createPickStep<CommitQuickPickItem<GitStashCommit>>({
		title: appendReposToTitle(options.title ?? context.title, state, context),
		multiselect: true,
		placeholder:
			typeof options.placeholder === 'string' ? options.placeholder : options.placeholder(context, options.stash),
		ignoreFocusOut: options.ignoreFocusOut,
		matchOnDescription: true,
		matchOnDetail: true,
		canGoBack: context.steps?.canGoBack,
		items: !options.stash?.stashes.size
			? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
			: [
					...map(options.stash.stashes.values(), stash =>
						createStashQuickPickItem(
							stash,
							options.picked != null &&
								(typeof options.picked === 'string'
									? stash.ref === options.picked
									: options.picked.includes(stash.ref)),
							{
								buttons: [ShowDetailsViewQuickInputButton],
								compact: true,
								icon: true,
							},
						),
					),
				],
		onDidClickItemButton: (_quickpick, button, { item }) => {
			if (button === ShowDetailsViewQuickInputButton) {
				void showStashInDetailsView(item, { pin: false, preserveFocus: true });
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (_quickpick, _key, { item }) => {
			await showStashInDetailsView(item, { pin: false, preserveFocus: true });
		},
	});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection.map(i => i.item) : StepResultBreak;
}
