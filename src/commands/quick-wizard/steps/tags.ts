import type { QuickInputButton } from 'vscode';
import { revealTag } from '../../../git/actions/tag.js';
import type { GitTagReference } from '../../../git/models/reference.js';
import type { Repository } from '../../../git/models/repository.js';
import type { GitTag } from '../../../git/models/tag.js';
import type { TagSortOptions } from '../../../git/utils/-webview/sorting.js';
import { createDirectiveQuickPickItem, Directive } from '../../../quickpicks/items/directive.js';
import type { TagQuickPickItem } from '../../../quickpicks/items/gitWizard.js';
import type {
	AsyncStepResultGenerator,
	PartialStepState,
	StepResultGenerator,
	StepsContext,
	StepSelection,
} from '../models/steps.js';
import { StepResultBreak } from '../models/steps.js';
import { RevealInSideBarQuickInputButton } from '../quickButtons.js';
import {
	appendReposToTitle,
	canInputStepContinue,
	canPickStepContinue,
	canStepContinue,
	createInputStep,
	createPickStep,
} from '../utils/steps.utils.js';
import { getBranchesAndOrTags } from './references.js';

export async function getTags(
	repo: Repository,
	options?: {
		buttons?: QuickInputButton[];
		filter?: (t: GitTag) => boolean;
		picked?: string | string[];
		sort?: TagSortOptions;
	},
): Promise<TagQuickPickItem[]> {
	return getBranchesAndOrTags(repo, ['tags'], {
		buttons: options?.buttons,
		filter: options?.filter != null ? { tags: options.filter } : undefined,
		picked: options?.picked,
		sort: options?.sort != null ? { tags: options.sort } : true,
	}) as Promise<TagQuickPickItem[]>;
}

export async function* inputTagNameStep<
	State extends PartialStepState & ({ repo: Repository } | { repos: Repository[] }),
	Context extends StepsContext<any> & { repos: Repository[]; showTags?: boolean },
>(
	state: State,
	context: Context,
	options: { placeholder?: string; prompt?: string; title?: string; value?: string },
): AsyncStepResultGenerator<string> {
	const step = createInputStep({
		title: appendReposToTitle(options.title ?? context.title, state, context),
		placeholder: options.placeholder ?? 'Tag name',
		value: options.value,
		prompt: options.prompt ?? 'Please provide a tag name',
		canGoBack: context.steps?.canGoBack,
		validate: async (value: string | undefined): Promise<[boolean, string | undefined]> => {
			if (!value) return [false, undefined];

			value = value.trim();
			if (!value.length) return [false, 'Please enter a valid tag name'];

			if ('repo' in state) {
				const valid = await state.repo.git.refs.checkIfCouldBeValidBranchOrTagName(value);
				if (!valid) return [false, `'${value}' isn't a valid tag name`];

				const alreadyExists = await state.repo.git.tags.getTag(value);
				if (alreadyExists) return [false, `A tag named '${value}' already exists`];

				return [true, undefined];
			}

			let valid = true;

			for (const repo of state.repos) {
				valid = await repo.git.refs.checkIfCouldBeValidBranchOrTagName(value);
				if (!valid) return [false, `'${value}' isn't a valid tag name`];

				const alreadyExists = await repo.git.tags.getTag(value);
				if (alreadyExists) return [false, `A tag named '${value}' already exists`];
			}

			return [true, undefined];
		},
	});

	const value: StepSelection<typeof step> = yield step;
	if (!canStepContinue(step, state, value) || !(await canInputStepContinue(step, state, value))) {
		return StepResultBreak;
	}

	return value;
}

export function* pickTagsStep<
	State extends PartialStepState & { repo: Repository },
	Context extends StepsContext<any> & { repos: Repository[]; showTags?: boolean },
>(
	state: State,
	context: Context,
	options: {
		filter?: (b: GitTag) => boolean;
		picked?: string | string[];
		placeholder: string;
		emptyPlaceholder?: string;
		sort?: TagSortOptions;
		title?: string;
	},
): StepResultGenerator<GitTagReference[]> {
	const items = getTags(state.repo, {
		buttons: [RevealInSideBarQuickInputButton],
		filter: options.filter,
		picked: options.picked,
		sort: options.sort,
	}).then(tags =>
		!tags.length
			? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
			: tags,
	);

	const step = createPickStep<TagQuickPickItem>({
		multiselect: true,
		title: appendReposToTitle(options.title ?? context.title, state, context),
		placeholder: count =>
			!count ? (options.emptyPlaceholder ?? `No tags found in ${state.repo.name}`) : options.placeholder,
		matchOnDetail: true,
		items: items,
		canGoBack: context.steps?.canGoBack,
		onDidClickItemButton: (_quickpick, button, { item }) => {
			if (button === RevealInSideBarQuickInputButton) {
				void revealTag(item, { select: true, focus: false, expand: true });
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (_quickpick, _key, { item }) => {
			await revealTag(item, { select: true, focus: false, expand: true });
		},
	});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection.map(i => i.item) : StepResultBreak;
}
