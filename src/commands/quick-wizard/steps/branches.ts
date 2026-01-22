import type { QuickInputButton, ThemeIcon } from 'vscode';
import { revealBranch } from '../../../git/actions/branch.js';
import type { GitBranch } from '../../../git/models/branch.js';
import type { GitBranchReference } from '../../../git/models/reference.js';
import type { Repository } from '../../../git/models/repository.js';
import type { BranchSortOptions } from '../../../git/utils/-webview/sorting.js';
import { createDirectiveQuickPickItem, Directive } from '../../../quickpicks/items/directive.js';
import type { BranchQuickPickItem } from '../../../quickpicks/items/gitWizard.js';
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

export async function getBranches(
	repos: Repository | Repository[],
	options?: {
		buttons?: QuickInputButton[];
		filter?: (b: GitBranch) => boolean;
		picked?: string | string[];
		sort?: BranchSortOptions;
	},
): Promise<BranchQuickPickItem[]> {
	return getBranchesAndOrTags(repos, ['branches'], {
		buttons: options?.buttons,
		filter: options?.filter != null ? { branches: options.filter } : undefined,
		picked: options?.picked,
		sort: options?.sort != null ? { branches: options.sort } : true,
	}) as Promise<BranchQuickPickItem[]>;
}

export async function* inputBranchNameStep<
	State extends PartialStepState & ({ repo: Repository } | { repos: Repository[] }),
	Context extends StepsContext<any> & { repos: Repository[]; showTags?: boolean },
>(
	state: State,
	context: Context,
	options?: { placeholder?: string; prompt?: string; title?: string; value?: string },
): AsyncStepResultGenerator<string> {
	const step = createInputStep({
		title: appendReposToTitle(options?.title ?? context.title, state, context),
		placeholder: options?.placeholder ?? 'Branch name',
		value: options?.value,
		prompt: options?.prompt ?? 'Please provide a branch name',
		canGoBack: context.steps?.canGoBack,
		validate: async (value: string | undefined): Promise<[boolean, string | undefined]> => {
			if (!value) return [false, undefined];

			value = value.trim();
			if (!value.length) return [false, 'Please enter a valid branch name'];

			if ('repo' in state) {
				const valid = await state.repo.git.refs.checkIfCouldBeValidBranchOrTagName(value);
				if (!valid) return [false, `'${value}' isn't a valid branch name`];

				const alreadyExists = await state.repo.git.branches.getBranch(value);
				if (alreadyExists) return [false, `A branch named '${value}' already exists`];

				return [true, undefined];
			}

			let valid = true;

			for (const repo of state.repos) {
				valid = await repo.git.refs.checkIfCouldBeValidBranchOrTagName(value);
				if (!valid) return [false, `'${value}' isn't a valid branch name`];

				const alreadyExists = await repo.git.branches.getBranch(value);
				if (alreadyExists) return [false, `A branch named '${value}' already exists`];
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

export function* pickBranchStep<
	State extends PartialStepState & { repo: Repository },
	Context extends StepsContext<any> & { repos: Repository[]; showTags?: boolean },
>(
	state: State,
	context: Context,
	options?: { filter?: (b: GitBranch) => boolean; picked?: string | string[]; placeholder: string; title?: string },
): StepResultGenerator<GitBranchReference> {
	const items = getBranches(state.repo, {
		buttons: [RevealInSideBarQuickInputButton],
		filter: options?.filter,
		picked: options?.picked,
	}).then(branches =>
		!branches.length
			? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
			: branches,
	);

	const step = createPickStep<BranchQuickPickItem>({
		title: appendReposToTitle(options?.title ?? context.title, state, context),
		placeholder: count => (!count ? `No branches found in ${state.repo.name}` : options?.placeholder),
		matchOnDetail: true,
		items: items,
		canGoBack: context.steps?.canGoBack,
		onDidClickItemButton: (_quickpick, button, { item }) => {
			if (button === RevealInSideBarQuickInputButton) {
				void revealBranch(item, { select: true, focus: false, expand: true });
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (_quickpick, _key, { item }) => {
			await revealBranch(item, { select: true, focus: false, expand: true });
		},
	});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
}

export function* pickBranchesStep<
	State extends PartialStepState & { repo: Repository },
	Context extends StepsContext<any> & { repos: Repository[]; showTags?: boolean },
>(
	state: State,
	context: Context,
	options?: {
		filter?: (b: GitBranch) => boolean;
		picked?: string | string[];
		placeholder: string;
		emptyPlaceholder?: string;
		sort?: BranchSortOptions;
		title?: string;
	},
): StepResultGenerator<GitBranchReference[]> {
	const items = getBranches(state.repo, {
		buttons: [RevealInSideBarQuickInputButton],
		filter: options?.filter,
		picked: options?.picked,
		sort: options?.sort,
	}).then(branches =>
		!branches.length
			? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
			: branches,
	);

	const step = createPickStep<BranchQuickPickItem>({
		multiselect: true,
		title: appendReposToTitle(options?.title ?? context.title, state, context),
		placeholder: count =>
			!count ? (options?.emptyPlaceholder ?? `No branches found in ${state.repo.name}`) : options?.placeholder,
		matchOnDetail: true,
		items: items,
		canGoBack: context.steps?.canGoBack,
		onDidClickItemButton: (_quickpick, button, { item }) => {
			if (button === RevealInSideBarQuickInputButton) {
				void revealBranch(item, { select: true, focus: false, expand: true });
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (_quickpick, _key, { item }) => {
			await revealBranch(item, { select: true, focus: false, expand: true });
		},
	});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection.map(i => i.item) : StepResultBreak;
}

export function* pickOrResetBranchStep<
	State extends PartialStepState & { repo: Repository },
	Context extends StepsContext<any> & { repos: Repository[]; showTags?: boolean },
>(
	state: State,
	context: Context,
	options?: {
		filter?: (b: GitBranch) => boolean;
		picked?: string | string[];
		placeholder: string;
		reset?: { label: string; description?: string; detail?: string; button?: { icon: ThemeIcon; tooltip: string } };
		title?: string;
	},
): StepResultGenerator<GitBranchReference | undefined> {
	const items = getBranches(state.repo, {
		buttons: [RevealInSideBarQuickInputButton],
		filter: options?.filter,
		picked: options?.picked,
	}).then(branches =>
		!branches.length
			? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
			: [
					...(options?.reset
						? [
								createDirectiveQuickPickItem(Directive.Reset, false, {
									label: options.reset.label,
									description: options.reset.description,
									detail: options.reset.detail,
								}),
							]
						: []),
					...branches,
				],
	);

	const resetButton: QuickInputButton | undefined = options?.reset?.button
		? { iconPath: options?.reset.button.icon, tooltip: options?.reset.button?.tooltip }
		: undefined;
	let resetButtonClicked = false;

	const step = createPickStep<BranchQuickPickItem>({
		title: appendReposToTitle(options?.title ?? context.title, state, context),
		placeholder: count => (!count ? `No branches found in ${state.repo.name}` : options?.placeholder),
		matchOnDetail: true,
		items: items,
		canGoBack: context.steps?.canGoBack,
		additionalButtons: resetButton ? [resetButton] : [],
		onDidClickButton: (_quickpick, button) => {
			if (button === resetButton) {
				resetButtonClicked = true;
				return true;
			}
			return false;
		},
		onDidClickItemButton: (_quickpick, button, { item }) => {
			if (button === RevealInSideBarQuickInputButton) {
				void revealBranch(item, { select: true, focus: false, expand: true });
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (_quickpick, _key, { item }) => {
			await revealBranch(item, { select: true, focus: false, expand: true });
		},
	});

	const selection: StepSelection<typeof step> = yield step;
	if (resetButtonClicked) return undefined;

	return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
}
