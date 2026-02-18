import { ThemeIcon } from 'vscode';
import { revealRepository } from '../../../git/actions/repository.js';
import type { Repository } from '../../../git/models/repository.js';
import type { GitStatus } from '../../../git/models/status.js';
import { groupRepositories } from '../../../git/utils/-webview/repository.utils.js';
import { sortRepositories, sortRepositoriesGrouped } from '../../../git/utils/-webview/sorting.js';
import { createReference } from '../../../git/utils/reference.utils.js';
import { createRevisionRange } from '../../../git/utils/revision.utils.js';
import {
	OpenChangedFilesCommandQuickPickItem,
	OpenOnlyChangedFilesCommandQuickPickItem,
} from '../../../quickpicks/items/commits.js';
import { CommandQuickPickItem } from '../../../quickpicks/items/common.js';
import type { DirectiveQuickPickItem } from '../../../quickpicks/items/directive.js';
import { createDirectiveQuickPickItem, Directive } from '../../../quickpicks/items/directive.js';
import type { RepositoryQuickPickItem } from '../../../quickpicks/items/gitWizard.js';
import { createRepositoryQuickPickItem, GitWizardQuickPickItem } from '../../../quickpicks/items/gitWizard.js';
import { filterMap, isStringArray } from '../../../system/array.js';
import { pluralize } from '../../../system/string.js';
import type { ViewsWithRepositoryFolders } from '../../../views/viewBase.js';
import type {
	AsyncStepResultGenerator,
	PartialStepState,
	StepResultGenerator,
	StepsContext,
	StepSelection,
} from '../models/steps.js';
import { StepResultBreak } from '../models/steps.js';
import type { QuickPickStep } from '../models/steps.quickpick.js';
import { RevealInSideBarQuickInputButton } from '../quickButtons.js';
import type { StepController } from '../stepsController.js';
import { appendReposToTitle, canPickStepContinue, createPickStep } from '../utils/steps.utils.js';

export async function* pickRepositoryStep<
	State extends PartialStepState & { repo?: string | Repository },
	Context extends StepsContext<any> & { repos: Repository[]; associatedView: ViewsWithRepositoryFolders },
>(
	state: State,
	context: Context,
	parentStep: StepController<any>,
	options?: { excludeWorktrees?: boolean; picked?: string | Repository; placeholder?: string },
): AsyncStepResultGenerator<Repository> {
	if (typeof state.repo === 'string') {
		state.repo = context.container.git.getRepository(state.repo);
		if (state.repo != null) {
			parentStep?.skip();
			return state.repo;
		}
	}

	const active =
		state.repo ??
		(options?.picked != null
			? typeof options.picked === 'string'
				? context.container.git.getRepository(options.picked)
				: options.picked
			: undefined) ??
		(await context.container.git.getOrOpenRepositoryForEditor());

	let repos = context.repos;
	const grouped = groupRepositories(repos);
	if (options?.excludeWorktrees) {
		repos = sortRepositories([...grouped.keys()]);
	} else {
		repos = sortRepositoriesGrouped(grouped);
	}

	if (repos.length === 1) {
		parentStep?.skip();
		return repos[0];
	}

	const placeholder = options?.placeholder ?? 'Choose a repository';

	const step = createPickStep<RepositoryQuickPickItem>({
		title: context.title,
		placeholder: !repos.length ? `${placeholder} — no opened repositories found` : placeholder,
		canGoBack: context.steps?.canGoBack,
		items: !repos.length
			? [
					createDirectiveQuickPickItem(Directive.Cancel, true, {
						label: 'Cancel',
						detail: 'No opened repositories found',
					}),
				]
			: Promise.all(
					repos.map(r =>
						createRepositoryQuickPickItem(r, r.id === active?.id, {
							branch: true,
							buttons: [RevealInSideBarQuickInputButton],
							fetched: true,
							indent: !grouped.has(r),
							status: true,
						}),
					),
				),
		onDidClickItemButton: (_quickpick, button, { item }) => {
			if (button === RevealInSideBarQuickInputButton) {
				void revealRepository(item.path, context.associatedView, { select: true, focus: false, expand: true });
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: (_quickpick, _key, { item }) => {
			void revealRepository(item.path, context.associatedView, { select: true, focus: false, expand: true });
		},
	});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
}

export async function* pickRepositoriesStep<
	State extends PartialStepState & { repos?: string[] | Repository[] },
	Context extends StepsContext<any> & { repos: Repository[]; associatedView: ViewsWithRepositoryFolders },
>(
	state: State,
	context: Context,
	parentStep: StepController<any>,
	options?: { excludeWorktrees?: boolean; placeholder?: string; skipIfPossible?: boolean },
): AsyncStepResultGenerator<Repository[]> {
	let actives: Repository[];
	if (state.repos != null) {
		if (isStringArray(state.repos)) {
			actives = filterMap(state.repos, path => context.repos.find(r => r.path === path));
			if (options?.skipIfPossible && actives.length && state.repos.length === actives.length) {
				parentStep?.skip();
				return actives;
			}
		} else {
			actives = state.repos;
		}
	} else {
		const active = await context.container.git.getOrOpenRepositoryForEditor();
		actives = active != null ? [active] : [];
	}

	let repos = context.repos;
	const grouped = groupRepositories(repos);
	if (options?.excludeWorktrees) {
		repos = sortRepositories([...grouped.keys()]);
	} else {
		repos = sortRepositoriesGrouped(grouped);
	}

	const placeholder = options?.placeholder ?? 'Choose a repository';

	const step = createPickStep<RepositoryQuickPickItem>({
		multiselect: true,
		title: context.title,
		placeholder: !repos.length ? `${placeholder} — no opened repositories found` : placeholder,
		canGoBack: context.steps?.canGoBack,
		items: !repos.length
			? [
					createDirectiveQuickPickItem(Directive.Cancel, true, {
						label: 'Cancel',
						detail: 'No opened repositories found',
					}),
				]
			: Promise.all(
					repos.map(repo =>
						createRepositoryQuickPickItem(
							repo,
							actives.some(r => r.id === repo.id),
							{
								branch: true,
								buttons: [RevealInSideBarQuickInputButton],
								fetched: true,
								indent: !grouped.has(repo),
								status: true,
							},
						),
					),
				),
		onDidClickItemButton: (_quickpick, button, { item }) => {
			if (button === RevealInSideBarQuickInputButton) {
				void revealRepository(item.path, context.associatedView, { select: true, focus: false, expand: true });
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: (_quickpick, _key, { item }) => {
			void revealRepository(item.path, context.associatedView, { select: true, focus: false, expand: true });
		},
	});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection.map(i => i.item) : StepResultBreak;
}

export function* showRepositoryStatusStep<
	State extends PartialStepState & { repo: Repository },
	Context extends StepsContext<any> & { repos: Repository[]; status: GitStatus },
>(state: State, context: Context): StepResultGenerator<CommandQuickPickItem> {
	const upstream = context.status.getUpstreamStatus({ expand: true, separator: ', ' });
	const working = context.status.getFormattedDiffStatus({ expand: true, separator: ', ' });
	const step: QuickPickStep<CommandQuickPickItem> = createPickStep<CommandQuickPickItem>({
		title: appendReposToTitle(context.title, state, context),
		placeholder: upstream ? `${upstream}, ${working}` : working, //'Changes to be committed',
		ignoreFocusOut: true,
		items: getShowRepositoryStatusStepItems(state, context),
		canGoBack: context.steps?.canGoBack,
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (_quickpick, key, item) => {
			await item.onDidPressKey(key);
		},
	});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection[0] : StepResultBreak;
}

function getShowRepositoryStatusStepItems<
	State extends PartialStepState & { repo: Repository },
	Context extends StepsContext<any> & { repos: Repository[]; status: GitStatus },
>(state: State, context: Context) {
	const items: (DirectiveQuickPickItem | CommandQuickPickItem)[] = [];

	const computed = context.status.computeWorkingTreeStatus();

	let workingTreeStatus;
	if (computed.staged === 0 && computed.unstaged === 0) {
		workingTreeStatus = 'No working tree changes';
	} else {
		workingTreeStatus = `$(files) ${
			computed.staged ? `${pluralize('staged file', computed.staged)} (${computed.stagedStatus})` : ''
		}${
			computed.unstaged
				? `${computed.staged ? ', ' : ''}${pluralize('unstaged file', computed.unstaged)} (${
						computed.unstagedStatus
					})`
				: ''
		}`;
	}

	if (context.status.upstream) {
		if (context.status.upstream.state.ahead === 0 && context.status.upstream.state.behind === 0) {
			items.push(
				createDirectiveQuickPickItem(Directive.Noop, true, {
					label: `$(git-branch) ${context.status.branch} is up to date with $(git-branch) ${context.status.upstream?.name}`,
					detail: workingTreeStatus,
				}),
			);
		} else if (context.status.upstream.state.ahead !== 0 && context.status.upstream.state.behind !== 0) {
			items.push(
				createDirectiveQuickPickItem(Directive.Noop, true, {
					label: `$(git-branch) ${context.status.branch} has diverged from $(git-branch) ${context.status.upstream?.name}`,
					detail: workingTreeStatus,
				}),
			);
		} else if (context.status.upstream.state.ahead !== 0) {
			items.push(
				createDirectiveQuickPickItem(Directive.Noop, true, {
					label: `$(git-branch) ${context.status.branch} is ahead of $(git-branch) ${context.status.upstream?.name}`,
					detail: workingTreeStatus,
				}),
			);
		} else if (context.status.upstream.state.behind !== 0) {
			items.push(
				createDirectiveQuickPickItem(Directive.Noop, true, {
					label: `$(git-branch) ${context.status.branch} is behind $(git-branch) ${context.status.upstream?.name}`,
					detail: workingTreeStatus,
				}),
			);
		}

		if (context.status.upstream.state.behind !== 0) {
			items.push(
				new GitWizardQuickPickItem(
					`$(cloud-download) ${pluralize('commit', context.status.upstream.state.behind)} behind`,
					{
						command: 'log',
						state: {
							repo: state.repo,
							reference: createReference(
								createRevisionRange(context.status.ref, context.status.upstream?.name, '..'),
								state.repo.path,
							),
						},
					},
				),
			);
		}

		if (context.status.upstream.state.ahead !== 0) {
			items.push(
				new GitWizardQuickPickItem(
					`$(cloud-upload) ${pluralize('commit', context.status.upstream.state.ahead)} ahead`,
					{
						command: 'log',
						state: {
							repo: state.repo,
							reference: createReference(
								createRevisionRange(context.status.upstream?.name, context.status.ref, '..'),
								state.repo.path,
							),
						},
					},
				),
			);
		}
	} else {
		items.push(
			createDirectiveQuickPickItem(Directive.Noop, true, {
				label: `$(git-branch) ${context.status.branch} has no upstream`,
				detail: workingTreeStatus,
			}),
		);
	}

	if (context.status.files.length) {
		items.push(
			new OpenChangedFilesCommandQuickPickItem([
				...computed.stagedAddsAndChanges,
				...computed.unstagedAddsAndChanges,
			]),
		);

		items.push(
			new OpenOnlyChangedFilesCommandQuickPickItem([
				...computed.stagedAddsAndChanges,
				...computed.unstagedAddsAndChanges,
			]),
		);
	}

	if (computed.staged > 0) {
		items.push(new OpenChangedFilesCommandQuickPickItem(computed.stagedAddsAndChanges, 'Open Staged Files'));

		items.push(
			new OpenOnlyChangedFilesCommandQuickPickItem(computed.stagedAddsAndChanges, 'Open Only Staged Files'),
		);
	}

	if (computed.unstaged > 0) {
		items.push(new OpenChangedFilesCommandQuickPickItem(computed.unstagedAddsAndChanges, 'Open Unstaged Files'));

		items.push(
			new OpenOnlyChangedFilesCommandQuickPickItem(computed.unstagedAddsAndChanges, 'Open Only Unstaged Files'),
		);
	}

	if (context.status.files.length) {
		items.push(
			new CommandQuickPickItem('Close Unchanged Files', new ThemeIcon('x'), 'gitlens.closeUnchangedFiles'),
		);
	}

	return items;
}
