import type { Disposable, TextEditor, Uri } from 'vscode';
import { window } from 'vscode';
import { Container } from '../container';
import type { Repository } from '../git/models/repository';
import { filterMap } from '../system/array';
import { map } from '../system/iterable';
import { getQuickPickIgnoreFocusOut } from '../system/vscode/utils';
import { CommandQuickPickItem } from './items/common';
import type { RepositoryQuickPickItem } from './items/gitWizard';
import { createRepositoryQuickPickItem } from './items/gitWizard';

export async function getBestRepositoryOrShowPicker(
	uri: Uri | undefined,
	editor: TextEditor | undefined,
	title: string,
	placeholder?: string,
	options?: { filter?: (r: Repository) => Promise<boolean> },
): Promise<Repository | undefined> {
	let repository = Container.instance.git.getBestRepository(uri, editor);

	if (repository != null && options?.filter != null) {
		if (!(await options.filter(repository))) {
			repository = undefined;
		}
	}
	if (repository != null) return repository;

	const pick = await showRepositoryPicker(title, placeholder, undefined, options);
	if (pick instanceof CommandQuickPickItem) {
		await pick.execute();
		return undefined;
	}

	return pick;
}

export async function getRepositoryOrShowPicker(
	title: string,
	placeholder?: string,
	uri?: Uri,
	options?: { filter?: (r: Repository) => Promise<boolean> },
): Promise<Repository | undefined> {
	let repository;
	if (uri == null) {
		repository = Container.instance.git.highlander;
	} else {
		repository = await Container.instance.git.getOrOpenRepository(uri);
	}

	if (repository != null && options?.filter != null) {
		if (!(await options.filter(repository))) {
			repository = undefined;
		}
	}
	if (repository != null) return repository;

	const pick = await showRepositoryPicker(title, placeholder, undefined, options);
	if (pick instanceof CommandQuickPickItem) {
		void (await pick.execute());
		return undefined;
	}

	return pick;
}

export async function showRepositoryPicker(
	title: string | undefined,
	placeholder?: string,
	repositories?: Repository[],
	options?: { filter?: (r: Repository) => Promise<boolean>; picked?: Repository },
): Promise<Repository | undefined> {
	repositories ??= Container.instance.git.openRepositories;

	let items: RepositoryQuickPickItem[];
	if (options?.filter == null) {
		items = await Promise.all<Promise<RepositoryQuickPickItem>>(
			map(repositories ?? Container.instance.git.openRepositories, r =>
				createRepositoryQuickPickItem(r, r === options?.picked, { branch: true, status: true }),
			),
		);
	} else {
		const { filter } = options;
		items = filterMap(
			await Promise.allSettled(
				map(Container.instance.git.openRepositories, async r =>
					(await filter(r))
						? createRepositoryQuickPickItem(r, r === options?.picked, { branch: true, status: true })
						: undefined,
				),
			),
			r => (r.status === 'fulfilled' ? r.value : undefined),
		);
	}

	if (items.length === 0) return undefined;

	const quickpick = window.createQuickPick<RepositoryQuickPickItem>();
	quickpick.ignoreFocusOut = getQuickPickIgnoreFocusOut();

	const disposables: Disposable[] = [];

	try {
		const pick = await new Promise<RepositoryQuickPickItem | undefined>(resolve => {
			disposables.push(
				quickpick.onDidHide(() => resolve(undefined)),
				quickpick.onDidAccept(() => {
					if (quickpick.activeItems.length !== 0) {
						resolve(quickpick.activeItems[0]);
					}
				}),
			);

			quickpick.title = title;
			quickpick.placeholder = placeholder;
			quickpick.matchOnDescription = true;
			quickpick.matchOnDetail = true;
			quickpick.items = items;

			quickpick.show();
		});

		return pick?.item;
	} finally {
		quickpick.dispose();
		disposables.forEach(d => void d.dispose());
	}
}

export async function showRepositoriesPicker(
	title: string | undefined,
	placeholder?: string,
	repositories?: Repository[],
): Promise<readonly Repository[]>;
export async function showRepositoriesPicker(
	title: string | undefined,
	placeholder?: string,
	options?: { filter?: (r: Repository) => Promise<boolean> },
): Promise<readonly Repository[]>;
export async function showRepositoriesPicker(
	title: string | undefined,
	placeholder: string = 'Choose a repository',
	repositoriesOrOptions?: Repository[] | { filter?: (r: Repository) => Promise<boolean> },
): Promise<readonly Repository[]> {
	if (
		repositoriesOrOptions != null &&
		!Array.isArray(repositoriesOrOptions) &&
		repositoriesOrOptions.filter == null
	) {
		repositoriesOrOptions = undefined;
	}

	let items: RepositoryQuickPickItem[];
	if (repositoriesOrOptions == null || Array.isArray(repositoriesOrOptions)) {
		items = await Promise.all<Promise<RepositoryQuickPickItem>>(
			map(repositoriesOrOptions ?? Container.instance.git.openRepositories, r =>
				createRepositoryQuickPickItem(r, undefined, { branch: true, status: true }),
			),
		);
	} else {
		const { filter } = repositoriesOrOptions;
		items = filterMap(
			await Promise.allSettled(
				map(Container.instance.git.openRepositories, async r =>
					(await filter!(r))
						? createRepositoryQuickPickItem(r, undefined, { branch: true, status: true })
						: undefined,
				),
			),
			r => (r.status === 'fulfilled' ? r.value : undefined),
		);
	}

	if (items.length === 0) return [];

	const quickpick = window.createQuickPick<RepositoryQuickPickItem>();
	quickpick.ignoreFocusOut = getQuickPickIgnoreFocusOut();

	const disposables: Disposable[] = [];

	try {
		const picks = await new Promise<readonly RepositoryQuickPickItem[] | undefined>(resolve => {
			disposables.push(
				quickpick.onDidHide(() => resolve(undefined)),
				quickpick.onDidAccept(() => resolve(quickpick.selectedItems)),
			);

			quickpick.title = title;
			quickpick.placeholder = placeholder;
			quickpick.matchOnDescription = true;
			quickpick.matchOnDetail = true;
			quickpick.items = items;
			quickpick.canSelectMany = true;

			// Select all the repositories by default
			quickpick.selectedItems = items;

			quickpick.show();
		});
		if (picks == null) return [];

		return picks.map(p => p.item);
	} finally {
		quickpick.dispose();
		disposables.forEach(d => void d.dispose());
	}
}
