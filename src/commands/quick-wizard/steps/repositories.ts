import { l10n, ThemeIcon } from 'vscode';
import { GitStatus } from '@gitlens/git/models/status.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import { createRevisionRange } from '@gitlens/git/utils/revision.utils.js';
import { isStringArray } from '@gitlens/utils/array.js';
import { formatPlural } from '@gitlens/utils/plural.js';
import { revealRepository } from '../../../git/actions/repository.js';
import type { GlRepository } from '../../../git/models/repository.js';
import { groupRepositories } from '../../../git/utils/-webview/repository.utils.js';
import { sortRepositories, sortRepositoriesGrouped } from '../../../git/utils/-webview/sorting.js';
import {
	OpenChangedFilesCommandQuickPickItem,
	OpenOnlyChangedFilesCommandQuickPickItem,
} from '../../../quickpicks/items/commits.js';
import { CommandQuickPickItem } from '../../../quickpicks/items/common.js';
import type { DirectiveQuickPickItem } from '../../../quickpicks/items/directive.js';
import { createDirectiveQuickPickItem, Directive } from '../../../quickpicks/items/directive.js';
import type { RepositoryQuickPickItem } from '../../../quickpicks/items/gitWizard.js';
import { createRepositoryQuickPickItem, GitWizardQuickPickItem } from '../../../quickpicks/items/gitWizard.js';
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

/**
 * Whether the wizard's single-repo short-circuit can use the sole available repository directly —
 * true only when there's exactly one available repo AND either nothing was requested OR the request
 * IS that repo. A request for a *different* path (e.g. an un-surfaced secondary worktree, which isn't
 * in `repos`) returns `false` so the caller resolves it via {@link pickRepositoryStep} instead of
 * silently using the only surfaced repo.
 */
export function canSkipRepositoryPick(repos: GlRepository[], requested: string | GlRepository | undefined): boolean {
	if (repos.length !== 1) return false;
	return requested == null || repos[0].path === (typeof requested === 'string' ? requested : requested.path);
}

/** Multi-repo counterpart of {@link canSkipRepositoryPick} — true only when there's exactly one
 *  available repo AND either nothing was requested or every requested repo is it. */
export function canSkipRepositoriesPick(
	repos: GlRepository[],
	requested: string[] | GlRepository[] | undefined,
): boolean {
	if (repos.length !== 1) return false;
	return (
		requested == null ||
		requested.length === 0 ||
		requested.every(r => repos[0].path === (typeof r === 'string' ? r : r.path))
	);
}

export async function* pickRepositoryStep<
	State extends PartialStepState & { repo?: string | GlRepository },
	Context extends StepsContext<any> & { repos: GlRepository[]; associatedView: ViewsWithRepositoryFolders },
>(
	state: State,
	context: Context,
	parentStep: StepController<any>,
	options?: { excludeWorktrees?: boolean; picked?: string | GlRepository; placeholder?: string },
): AsyncStepResultGenerator<GlRepository> {
	if (typeof state.repo === 'string') {
		// Resolve the path, adding it un-surfaced (`opened: false`) when not already known — e.g. a
		// secondary worktree shown in the Graph, which isn't surfaced as a repository. Without the
		// fallback an un-surfaced worktree path wouldn't resolve and would fall through to the picker.
		state.repo = await context.container.git.getOrAddRepository(state.repo, { opened: false });
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
		(await context.container.git.getOrAddRepositoryForEditor());

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

	const placeholder = options?.placeholder ?? l10n.t('Choose a repository');

	const step = createPickStep<RepositoryQuickPickItem>({
		title: context.title,
		placeholder: !repos.length ? l10n.t('{0} — no opened repositories found', placeholder) : placeholder,
		canGoBack: context.steps?.canGoBack,
		items: !repos.length
			? [
					createDirectiveQuickPickItem(Directive.Cancel, true, {
						label: l10n.t('Cancel'),
						detail: l10n.t('No opened repositories found'),
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
	State extends PartialStepState & { repos?: string[] | GlRepository[] },
	Context extends StepsContext<any> & { repos: GlRepository[]; associatedView: ViewsWithRepositoryFolders },
>(
	state: State,
	context: Context,
	parentStep: StepController<any>,
	options?: { excludeWorktrees?: boolean; placeholder?: string; skipIfPossible?: boolean },
): AsyncStepResultGenerator<GlRepository[]> {
	let actives: GlRepository[];
	if (state.repos != null) {
		if (isStringArray(state.repos)) {
			// Resolve each path, adding it un-surfaced (`opened: false`) when not already known — e.g. a
			// secondary worktree shown in the Graph, which isn't surfaced as a repository.
			actives = (
				await Promise.all(
					state.repos.map(
						async path =>
							context.repos.find(r => r.path === path) ??
							(await context.container.git.getOrAddRepository(path, { opened: false })),
					),
				)
			).filter((r): r is GlRepository => r != null);
			if (options?.skipIfPossible && actives.length && state.repos.length === actives.length) {
				parentStep?.skip();
				return actives;
			}
		} else {
			actives = state.repos;
		}
	} else {
		const active = await context.container.git.getOrAddRepositoryForEditor();
		actives = active != null ? [active] : [];
	}

	let repos = context.repos;
	const grouped = groupRepositories(repos);
	if (options?.excludeWorktrees) {
		repos = sortRepositories([...grouped.keys()]);
	} else {
		repos = sortRepositoriesGrouped(grouped);
	}

	const placeholder = options?.placeholder ?? l10n.t('Choose a repository');

	const step = createPickStep<RepositoryQuickPickItem>({
		multiselect: true,
		title: context.title,
		placeholder: !repos.length ? l10n.t('{0} — no opened repositories found', placeholder) : placeholder,
		canGoBack: context.steps?.canGoBack,
		items: !repos.length
			? [
					createDirectiveQuickPickItem(Directive.Cancel, true, {
						label: l10n.t('Cancel'),
						detail: l10n.t('No opened repositories found'),
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
	State extends PartialStepState & { repo: GlRepository },
	Context extends StepsContext<any> & { repos: GlRepository[]; status: GitStatus },
>(state: State, context: Context): StepResultGenerator<CommandQuickPickItem> {
	const upstream = GitStatus.getUpstreamStatus(context.status, { expand: true, separator: ', ' });
	const working = GitStatus.getFormattedDiffStatus(context.status, { expand: true, separator: ', ' });
	const step: QuickPickStep<CommandQuickPickItem> = createPickStep<CommandQuickPickItem>({
		title: appendReposToTitle(context.title, state, context),
		placeholder: upstream ? l10n.t('{0}, {1}', upstream, working) : working, //'Changes to be committed',
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
	State extends PartialStepState & { repo: GlRepository },
	Context extends StepsContext<any> & { repos: GlRepository[]; status: GitStatus },
>(state: State, context: Context) {
	const items: (DirectiveQuickPickItem | CommandQuickPickItem)[] = [];

	const computed = GitStatus.computeWorkingTreeStatus(context.status);

	let workingTreeStatus: string;
	if (computed.staged === 0 && computed.unstaged === 0) {
		workingTreeStatus = l10n.t('No working tree changes');
	} else if (computed.staged === 0) {
		workingTreeStatus = formatPlural(
			l10n.t('{0, plural, one{$(files) {0} unstaged file ({1})} other{$(files) {0} unstaged files ({1})}}'),
			[computed.unstaged, computed.unstagedStatus],
		);
	} else if (computed.unstaged === 0) {
		workingTreeStatus = formatPlural(
			l10n.t('{0, plural, one{$(files) {0} staged file ({1})} other{$(files) {0} staged files ({1})}}'),
			[computed.staged, computed.stagedStatus],
		);
	} else {
		workingTreeStatus = formatPlural(
			l10n.t(
				'{0, plural, one{{2, plural, one{$(files) {0} staged file ({1}), {2} unstaged file ({3})} other{$(files) {0} staged file ({1}), {2} unstaged files ({3})}}} other{{2, plural, one{$(files) {0} staged files ({1}), {2} unstaged file ({3})} other{$(files) {0} staged files ({1}), {2} unstaged files ({3})}}}}',
			),
			[computed.staged, computed.stagedStatus, computed.unstaged, computed.unstagedStatus],
		);
	}

	if (context.status.upstream) {
		if (context.status.upstream.state.ahead === 0 && context.status.upstream.state.behind === 0) {
			items.push(
				createDirectiveQuickPickItem(Directive.Noop, true, {
					label: l10n.t(
						'$(git-branch) {0} is up to date with $(git-branch) {1}',
						context.status.branch,
						context.status.upstream?.name,
					),
					detail: workingTreeStatus,
				}),
			);
		} else if (context.status.upstream.state.ahead !== 0 && context.status.upstream.state.behind !== 0) {
			items.push(
				createDirectiveQuickPickItem(Directive.Noop, true, {
					label: l10n.t(
						'$(git-branch) {0} has diverged from $(git-branch) {1}',
						context.status.branch,
						context.status.upstream?.name,
					),
					detail: workingTreeStatus,
				}),
			);
		} else if (context.status.upstream.state.ahead !== 0) {
			items.push(
				createDirectiveQuickPickItem(Directive.Noop, true, {
					label: l10n.t(
						'$(git-branch) {0} is ahead of $(git-branch) {1}',
						context.status.branch,
						context.status.upstream?.name,
					),
					detail: workingTreeStatus,
				}),
			);
		} else if (context.status.upstream.state.behind !== 0) {
			items.push(
				createDirectiveQuickPickItem(Directive.Noop, true, {
					label: l10n.t(
						'$(git-branch) {0} is behind $(git-branch) {1}',
						context.status.branch,
						context.status.upstream?.name,
					),
					detail: workingTreeStatus,
				}),
			);
		}

		if (context.status.upstream.state.behind !== 0) {
			const behind = context.status.upstream.state.behind;
			items.push(
				new GitWizardQuickPickItem(
					formatPlural(
						l10n.t(
							'{0, plural, one{$(cloud-download) {0} commit behind} other{$(cloud-download) {0} commits behind}}',
						),
						[behind],
					),
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
			const ahead = context.status.upstream.state.ahead;
			items.push(
				new GitWizardQuickPickItem(
					formatPlural(
						l10n.t(
							'{0, plural, one{$(cloud-upload) {0} commit ahead} other{$(cloud-upload) {0} commits ahead}}',
						),
						[ahead],
					),
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
				label: l10n.t('$(git-branch) {0} has no upstream', context.status.branch),
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
		items.push(
			new OpenChangedFilesCommandQuickPickItem(computed.stagedAddsAndChanges, l10n.t('Open Staged Files')),
		);

		items.push(
			new OpenOnlyChangedFilesCommandQuickPickItem(
				computed.stagedAddsAndChanges,
				l10n.t('Open Only Staged Files'),
			),
		);
	}

	if (computed.unstaged > 0) {
		items.push(
			new OpenChangedFilesCommandQuickPickItem(computed.unstagedAddsAndChanges, l10n.t('Open Unstaged Files')),
		);

		items.push(
			new OpenOnlyChangedFilesCommandQuickPickItem(
				computed.unstagedAddsAndChanges,
				l10n.t('Open Only Unstaged Files'),
			),
		);
	}

	if (context.status.files.length) {
		items.push(
			new CommandQuickPickItem(
				l10n.t('Close Unchanged Files'),
				new ThemeIcon('x'),
				'gitlens.closeUnchangedFiles',
			),
		);
	}

	return items;
}
