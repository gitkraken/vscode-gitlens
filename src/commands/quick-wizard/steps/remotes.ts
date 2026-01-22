import type { QuickInputButton } from 'vscode';
import { revealRemote } from '../../../git/actions/remote.js';
import type { GitRemote } from '../../../git/models/remote.js';
import type { Repository } from '../../../git/models/repository.js';
import { remoteUrlRegex } from '../../../git/parsers/remoteParser.js';
import { createDirectiveQuickPickItem, Directive } from '../../../quickpicks/items/directive.js';
import type { RemoteQuickPickItem } from '../../../quickpicks/items/gitWizard.js';
import { createRemoteQuickPickItem } from '../../../quickpicks/items/gitWizard.js';
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

export async function getRemotes(
	repo: Repository,
	options?: { buttons?: QuickInputButton[]; filter?: (r: GitRemote) => boolean; picked?: string | string[] },
): Promise<RemoteQuickPickItem[]> {
	const remotes = await repo.git.remotes.getRemotes({ filter: options?.filter, sort: true });
	if (!remotes.length) return [];

	const items: RemoteQuickPickItem[] = [];
	for (const remote of remotes) {
		items.push(
			createRemoteQuickPickItem(
				remote,
				options?.picked != null &&
					(typeof options.picked === 'string'
						? remote.name === options.picked
						: options.picked.includes(remote.name)),
				{ buttons: options?.buttons, upstream: true },
			),
		);
	}

	return items;
}

export async function* inputRemoteNameStep<
	State extends PartialStepState & { repo: Repository; remote?: GitRemote },
	Context extends StepsContext<any> & { repos: Repository[] },
>(
	state: State,
	context: Context,
	options?: { placeholder?: string; prompt?: string; title?: string; value?: string },
): AsyncStepResultGenerator<string> {
	const step = createInputStep({
		title: appendReposToTitle(options?.title ?? context.title, state, context),
		placeholder: options?.placeholder ?? 'Remote name',
		value: options?.value ?? state.remote?.name,
		prompt: options?.prompt ?? 'Please provide a name for the remote',
		canGoBack: context.steps?.canGoBack,
		validate: async (value: string | undefined): Promise<[boolean, string | undefined]> => {
			if (!value) return [false, undefined];

			value = value.trim();
			if (!value.length) return [false, 'Please enter a valid remote name'];

			const valid = !/[^a-zA-Z0-9-_.]/.test(value);
			if (!valid) return [false, `'${value}' isn't a valid remote name`];

			const remotes = await state.repo.git.remotes.getRemotes({ filter: r => r.name === value });
			if (remotes.length) return [false, `A remote named '${value}' already exists`];

			return [true, undefined];
		},
	});

	const value: StepSelection<typeof step> = yield step;
	if (!canStepContinue(step, state, value) || !(await canInputStepContinue(step, state, value))) {
		return StepResultBreak;
	}

	return value;
}

export async function* inputRemoteUrlStep<
	State extends PartialStepState & { repo: Repository; remote?: GitRemote },
	Context extends StepsContext<any> & { repos: Repository[] },
>(
	state: State,
	context: Context,
	options?: { placeholder?: string; prompt?: string; title?: string; value?: string },
): AsyncStepResultGenerator<string> {
	const step = createInputStep({
		title: appendReposToTitle(options?.title ?? context.title, state, context),
		placeholder: options?.placeholder ?? 'Remote URL',
		value: options?.value ?? state.remote?.url,
		prompt: options?.prompt ?? 'Please provide a URL for the remote',
		canGoBack: context.steps?.canGoBack,
		validate: (value: string | undefined): [boolean, string | undefined] => {
			if (!value) return [false, undefined];

			value = value.trim();
			if (!value.length) return [false, 'Please enter a valid remote URL'];

			const valid = remoteUrlRegex.test(value);
			return [valid, valid ? undefined : `'${value}' isn't a valid remote URL`];
		},
	});

	const value: StepSelection<typeof step> = yield step;
	if (!canStepContinue(step, state, value) || !(await canInputStepContinue(step, state, value))) {
		return StepResultBreak;
	}

	return value;
}

export function* pickRemoteStep<
	State extends PartialStepState & { repo: Repository },
	Context extends StepsContext<any> & { repos: Repository[] },
>(
	state: State,
	context: Context,
	options: { filter?: (r: GitRemote) => boolean; picked?: string | string[]; placeholder: string; title?: string },
): StepResultGenerator<GitRemote> {
	const items = getRemotes(state.repo, {
		buttons: [RevealInSideBarQuickInputButton],
		filter: options.filter,
		picked: options.picked,
	}).then(remotes =>
		!remotes.length
			? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
			: remotes,
	);

	const step = createPickStep<RemoteQuickPickItem>({
		title: appendReposToTitle(options.title ?? context.title, state, context),
		placeholder: count => (!count ? `No remotes found in ${state.repo.name}` : options.placeholder),
		matchOnDetail: true,
		items: items,
		canGoBack: context.steps?.canGoBack,
		onDidClickItemButton: (_quickpick, button, { item }) => {
			if (button === RevealInSideBarQuickInputButton) {
				void revealRemote(item, { select: true, focus: false, expand: true });
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (_quickpick, _key, { item }) => {
			await revealRemote(item, { select: true, focus: false, expand: true });
		},
	});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
}

export function* pickRemotesStep<
	State extends PartialStepState & { repo: Repository },
	Context extends StepsContext<any> & { repos: Repository[] },
>(
	state: State,
	context: Context,
	options: { filter?: (b: GitRemote) => boolean; picked?: string | string[]; placeholder: string; title?: string },
): StepResultGenerator<GitRemote[]> {
	const items = getRemotes(state.repo, {
		buttons: [RevealInSideBarQuickInputButton],
		filter: options.filter,
		picked: options.picked,
	}).then(remotes =>
		!remotes.length
			? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
			: remotes,
	);

	const step = createPickStep<RemoteQuickPickItem>({
		multiselect: true,
		title: appendReposToTitle(options.title ?? context.title, state, context),
		placeholder: count => (!count ? `No remotes found in ${state.repo.name}` : options.placeholder),
		matchOnDetail: true,
		items: items,
		canGoBack: context.steps?.canGoBack,
		onDidClickItemButton: (_quickpick, button, { item }) => {
			if (button === RevealInSideBarQuickInputButton) {
				void revealRemote(item, { select: true, focus: false, expand: true });
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (_quickpick, _key, { item }) => {
			await revealRemote(item, { select: true, focus: false, expand: true });
		},
	});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection.map(i => i.item) : StepResultBreak;
}
