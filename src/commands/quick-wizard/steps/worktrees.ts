import type { QuickInputButton } from 'vscode';
import { revealWorktree } from '../../../git/actions/worktree.js';
import type { Repository } from '../../../git/models/repository.js';
import type { GitWorktree } from '../../../git/models/worktree.js';
import { sortWorktrees } from '../../../git/utils/-webview/sorting.js';
import type { WorktreeQuickPickItem } from '../../../git/utils/-webview/worktree.quickpick.js';
import { createWorktreeQuickPickItem } from '../../../git/utils/-webview/worktree.quickpick.js';
import { createDirectiveQuickPickItem, Directive } from '../../../quickpicks/items/directive.js';
import { openWorkspace } from '../../../system/-webview/vscode/workspaces.js';
import { filterMap } from '../../../system/array.js';
import { Logger } from '../../../system/logger.js';
import type { PartialStepState, StepResultGenerator, StepsContext, StepSelection } from '../models/steps.js';
import { StepResultBreak } from '../models/steps.js';
import { OpenInNewWindowQuickInputButton, RevealInSideBarQuickInputButton } from '../quickButtons.js';
import { appendReposToTitle, canPickStepContinue, createPickStep } from '../utils/steps.utils.js';

export async function getWorktrees(
	repoOrWorktrees: Repository | GitWorktree[],
	options?: {
		buttons?: QuickInputButton[];
		excludeOpened?: boolean;
		filter?: (wt: GitWorktree) => boolean;
		includeStatus?: boolean;
		picked?: string | string[];
	},
): Promise<WorktreeQuickPickItem[]> {
	const worktrees = Array.isArray(repoOrWorktrees)
		? repoOrWorktrees
		: await repoOrWorktrees.git.worktrees?.getWorktrees();
	if (!worktrees?.length) return [];

	const items = filterMap(
		await Promise.allSettled(
			worktrees.map(async wt => {
				if ((options?.excludeOpened && wt.opened) || options?.filter?.(wt) === false) return undefined;

				let missing = false;
				let hasChanges;
				if (options?.includeStatus) {
					try {
						hasChanges = await wt.hasWorkingChanges();
					} catch (ex) {
						Logger.error(ex, `Worktree status failed: ${wt.uri.toString(true)}`);
						missing = true;
					}
				}

				return createWorktreeQuickPickItem(
					wt,
					options?.picked != null &&
						(typeof options.picked === 'string'
							? wt.uri.toString() === options.picked
							: options.picked.includes(wt.uri.toString())),
					missing,
					{
						buttons: options?.buttons,
						hasChanges: hasChanges,
						includeStatus: options?.includeStatus,
						path: true,
					},
				);
			}),
		),
		r => (r.status === 'fulfilled' ? r.value : undefined),
	);

	return sortWorktrees(items);
}

export function* pickWorktreeStep<
	State extends PartialStepState & { repo: Repository },
	Context extends StepsContext<any> & { repos: Repository[]; worktrees?: GitWorktree[] },
>(
	state: State,
	context: Context,
	options: {
		excludeOpened?: boolean;
		filter?: (b: GitWorktree) => boolean;
		includeStatus?: boolean;
		picked?: string | string[];
		placeholder: string;
		title?: string;
	},
): StepResultGenerator<GitWorktree> {
	const items = getWorktrees(context.worktrees ?? state.repo, {
		buttons: [OpenInNewWindowQuickInputButton, RevealInSideBarQuickInputButton],
		excludeOpened: options.excludeOpened,
		filter: options.filter,
		includeStatus: options.includeStatus,
		picked: options.picked,
	}).then(worktrees =>
		!worktrees.length
			? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
			: worktrees,
	);

	const step = createPickStep<WorktreeQuickPickItem>({
		title: appendReposToTitle(options.title ?? context.title, state, context),
		placeholder: count => (!count ? `No worktrees found in ${state.repo.name}` : options.placeholder),
		matchOnDetail: true,
		items: items,
		canGoBack: context.steps?.canGoBack,
		onDidClickItemButton: (_quickpick, button, { item }) => {
			switch (button) {
				case OpenInNewWindowQuickInputButton:
					openWorkspace(item.uri, { location: 'newWindow' });
					break;
				case RevealInSideBarQuickInputButton:
					void revealWorktree(item, { select: true, focus: false, expand: true });
					break;
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (_quickpick, _key, { item }) => {
			await revealWorktree(item, { select: true, focus: false, expand: true });
		},
	});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
}

export function* pickWorktreesStep<
	State extends PartialStepState & { repo: Repository },
	Context extends StepsContext<any> & { repos: Repository[]; worktrees?: GitWorktree[] },
>(
	state: State,
	context: Context,
	options: {
		excludeOpened?: boolean;
		filter?: (b: GitWorktree) => boolean;
		includeStatus?: boolean;
		picked?: string | string[];
		placeholder: string;
		title?: string;
	},
): StepResultGenerator<GitWorktree[]> {
	const items = getWorktrees(context.worktrees ?? state.repo, {
		buttons: [OpenInNewWindowQuickInputButton, RevealInSideBarQuickInputButton],
		excludeOpened: options.excludeOpened,
		filter: options.filter,
		includeStatus: options.includeStatus,
		picked: options.picked,
	}).then(worktrees =>
		!worktrees.length
			? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
			: worktrees,
	);

	const step = createPickStep<WorktreeQuickPickItem>({
		multiselect: true,
		title: appendReposToTitle(options.title ?? context.title, state, context),
		placeholder: count => (!count ? `No worktrees found in ${state.repo.name}` : options.placeholder),
		matchOnDetail: true,
		items: items,
		canGoBack: context.steps?.canGoBack,
		onDidClickItemButton: (_quickpick, button, { item }) => {
			switch (button) {
				case OpenInNewWindowQuickInputButton:
					openWorkspace(item.uri, { location: 'newWindow' });
					break;
				case RevealInSideBarQuickInputButton:
					void revealWorktree(item, { select: true, focus: false, expand: true });
					break;
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (_quickpick, _key, { item }) => {
			await revealWorktree(item, { select: true, focus: false, expand: true });
		},
	});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection.map(i => i.item) : StepResultBreak;
}
