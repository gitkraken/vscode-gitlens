import type { Disposable, TextEditor, Uri } from 'vscode';
import { window } from 'vscode';
import { GlyphChars } from '../constants';
import type { Container } from '../container';
import type { Repository } from '../git/models/repository';
import { groupRepositories } from '../git/utils/-webview/repository.utils';
import { sortRepositories, sortRepositoriesGrouped } from '../git/utils/-webview/sorting';
import { getQuickPickIgnoreFocusOut } from '../system/-webview/vscode';
import { filterMap } from '../system/array';
import { map } from '../system/iterable';
import type { QuickPickResult } from './items/common';
import { createQuickPickSeparator } from './items/common';
import type { DirectiveQuickPickItem } from './items/directive';
import { isDirectiveQuickPickItem } from './items/directive';
import type { RepositoryQuickPickItem } from './items/gitWizard';
import { createRepositoryQuickPickItem } from './items/gitWizard';

export async function getBestRepositoryOrShowPicker(
	container: Container,
	uri: Uri | undefined,
	editor: TextEditor | undefined,
	title: string,
	placeholder?: string,
	options?: { excludeWorktrees?: boolean; filter?: (r: Repository) => Promise<boolean> },
): Promise<Repository | undefined> {
	return getRepositoryOrShowPickerCore(
		container,
		container.git.getBestRepository(uri, editor),
		title,
		placeholder,
		options,
	);
}

export async function getRepositoryOrShowPicker(
	container: Container,
	title: string,
	placeholder?: string,
	pathOrUri?: string | Uri,
	options?: { excludeWorktrees?: boolean; filter?: (r: Repository) => Promise<boolean> },
): Promise<Repository | undefined> {
	return getRepositoryOrShowPickerCore(
		container,
		pathOrUri == null ? container.git.highlander : await container.git.getOrOpenRepository(pathOrUri),
		title,
		placeholder,
		options,
	);
}

async function getRepositoryOrShowPickerCore(
	container: Container,
	repository: Repository | undefined,
	title: string,
	placeholder?: string,
	options?: { excludeWorktrees?: boolean; filter?: (r: Repository) => Promise<boolean> },
): Promise<Repository | undefined> {
	if (repository != null && options?.filter != null) {
		if (!(await options.filter(repository))) {
			repository = undefined;
		}
	}
	if (repository != null) return repository;

	const result = await showRepositoryPicker2(container, title, placeholder, undefined, {
		autoPick: true,
		...options,
	});
	return result?.value;
}

export async function showRepositoryPicker(
	container: Container,
	title: string | undefined,
	placeholder?: string,
	repositories?: readonly Repository[],
	options?: { excludeWorktrees?: boolean; filter?: (r: Repository) => Promise<boolean>; picked?: Repository },
): Promise<Repository | undefined> {
	const result = await showRepositoryPicker2(container, title, placeholder, repositories, options);
	return result?.value;
}

export async function showRepositoryPicker2(
	container: Container,
	title: string | undefined,
	placeholder?: string,
	repositories?: readonly Repository[],
	options?: {
		additionalItem?: DirectiveQuickPickItem;
		autoPick?: boolean;
		excludeWorktrees?: boolean;
		filter?: (r: Repository) => Promise<boolean>;
		picked?: Repository;
	},
): Promise<QuickPickResult<Repository>> {
	let repos: Iterable<Repository> = (repositories ??= container.git.openRepositories);

	if (options?.filter != null) {
		const { filter } = options;
		repos = filterMap(
			await Promise.allSettled(map(repositories, async r => ((await filter(r)) ? r : undefined))),
			r => (r.status === 'fulfilled' ? r.value : undefined),
		);
	}

	const grouped = await groupRepositories(repos);
	if (options?.excludeWorktrees) {
		repos = sortRepositories([...grouped.keys()]);
	} else {
		repos = sortRepositoriesGrouped(grouped);
	}

	const items = await Promise.all<Promise<DirectiveQuickPickItem | RepositoryQuickPickItem>>(
		map(repos, r =>
			createRepositoryQuickPickItem(r, r === options?.picked, {
				branch: true,
				indent: !grouped.has(r),
				status: true,
			}),
		),
	);
	if (!items.length) return { value: undefined };

	if (options?.additionalItem != null) {
		items.unshift(options.additionalItem, createQuickPickSeparator());
	} else if (options?.autoPick && items.length === 1) {
		return { value: (items[0] as RepositoryQuickPickItem).item };
	}

	const quickpick = window.createQuickPick<DirectiveQuickPickItem | RepositoryQuickPickItem>();
	quickpick.ignoreFocusOut = getQuickPickIgnoreFocusOut();

	const disposables: Disposable[] = [];

	try {
		const pick = await new Promise<QuickPickResult<Repository>>(resolve => {
			disposables.push(
				quickpick.onDidHide(() => resolve({ value: undefined })),
				quickpick.onDidAccept(() => {
					if (!quickpick.activeItems.length) return;

					const [item] = quickpick.activeItems;
					if (isDirectiveQuickPickItem(item)) {
						resolve({ directive: item.directive });
					} else {
						resolve({ value: item?.item });
					}
				}),
			);

			quickpick.title = title;
			quickpick.placeholder = placeholder;
			quickpick.matchOnDescription = true;
			quickpick.matchOnDetail = true;
			quickpick.items = items;
			quickpick.activeItems = items.filter(i => i.picked);

			quickpick.show();
		});

		return pick;
	} finally {
		quickpick.dispose();
		disposables.forEach(d => void d.dispose());
	}
}

export async function showRepositoriesPicker(
	container: Container,
	title: string | undefined,
	placeholder?: string,
	repositories?: Repository[],
	options?: {
		excludeWorktrees?: boolean;
		filter?: (r: Repository) => Promise<boolean>;
		picked?: readonly Repository[];
	},
): Promise<readonly Repository[]> {
	const result = await showRepositoriesPicker2(container, title, placeholder, repositories, options);
	return result?.value ?? [];
}

export async function showRepositoriesPicker2(
	container: Container,
	title: string | undefined,
	placeholder?: string,
	repositories?: readonly Repository[],
	options?: {
		excludeWorktrees?: boolean;
		filter?: (r: Repository) => Promise<boolean>;
		picked?: readonly Repository[];
	},
): Promise<QuickPickResult<Repository[]>> {
	let repos: Iterable<Repository> = (repositories ??= container.git.openRepositories);

	if (options?.filter != null) {
		const { filter } = options;
		repos = filterMap(
			await Promise.allSettled(map(repositories, async r => ((await filter(r)) ? r : undefined))),
			r => (r.status === 'fulfilled' ? r.value : undefined),
		);
	}

	const grouped = await groupRepositories(repos);
	if (options?.excludeWorktrees) {
		repos = sortRepositories([...grouped.keys()]);
	} else {
		repos = sortRepositoriesGrouped(grouped);
	}

	const items = await Promise.all<Promise<RepositoryQuickPickItem>>(
		map(repos, r => createRepositoryQuickPickItem(r, options?.picked?.includes(r), { branch: true, status: true })),
	);
	if (!items.length) return { value: undefined };

	const quickpick = window.createQuickPick<RepositoryQuickPickItem>();
	quickpick.ignoreFocusOut = getQuickPickIgnoreFocusOut();

	const disposables: Disposable[] = [];

	try {
		const pick = await new Promise<QuickPickResult<Repository[]>>(resolve => {
			disposables.push(
				quickpick.onDidHide(() => resolve({ value: undefined })),
				quickpick.onDidAccept(() => resolve({ value: quickpick.selectedItems.map(i => i.item) })),
			);

			quickpick.title = title;
			quickpick.placeholder = placeholder;
			quickpick.matchOnDescription = true;
			quickpick.matchOnDetail = true;
			quickpick.items = items;
			quickpick.canSelectMany = true;

			const picked = items.filter(i => i.picked);
			// Select all the repositories by default
			quickpick.selectedItems = picked.length ? picked : items;

			quickpick.show();
		});

		return pick;
	} finally {
		quickpick.dispose();
		disposables.forEach(d => void d.dispose());
	}
}

export async function getRepositoryPickerTitleAndPlaceholder(
	repositories: Repository[],
	action: string,
	context?: string,
): Promise<{ title: string; placeholder: string }> {
	let hasWorktrees = false;
	for (const r of repositories) {
		if (await r.isWorktree()) {
			hasWorktrees = true;
			break;
		}
	}

	const title = context
		? `${action} ${hasWorktrees ? 'Repository or Worktree' : 'Repository'} ${GlyphChars.Dot} ${context}`
		: action;
	const placeholder = `Select a ${hasWorktrees ? 'repository or worktree' : 'repository'} to ${action.toLowerCase()} to`;

	return { title: title, placeholder: placeholder };
}
