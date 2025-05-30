import type { Disposable, TextEditor, Uri } from 'vscode';
import { window } from 'vscode';
import { Container } from '../container';
import type { Repository } from '../git/models/repository';
import { filterMapAsync } from '../system/array';
import { map } from '../system/iterable';
import { getQuickPickIgnoreFocusOut } from '../system/utils';
import { CommandQuickPickItem } from './items/common';
import type { RepositoryQuickPickItem } from './items/gitCommands';
import { createRepositoryQuickPickItem } from './items/gitCommands';

export async function getBestRepositoryOrShowPicker(
	uri: Uri | undefined,
	editor: TextEditor | undefined,
	title: string,
	options?: { filter?: (r: Repository) => Promise<boolean> },
): Promise<Repository | undefined> {
	let repository = Container.instance.git.getBestRepository(uri, editor);

	if (repository != null && options?.filter != null) {
		if (!(await options.filter(repository))) {
			repository = undefined;
		}
	}
	if (repository != null) return repository;

	const pick = await showRepositoryPicker(title, undefined, options);
	if (pick instanceof CommandQuickPickItem) {
		await pick.execute();
		return undefined;
	}

	return pick?.item;
}

export async function getRepositoryOrShowPicker(
	title: string,
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

	const pick = await showRepositoryPicker(title, undefined, options);
	if (pick instanceof CommandQuickPickItem) {
		void (await pick.execute());
		return undefined;
	}

	return pick?.item;
}

export async function showRepositoryPicker(
	title: string | undefined,
	placeholder?: string,
	repositories?: Repository[],
): Promise<RepositoryQuickPickItem | undefined>;
export async function showRepositoryPicker(
	title: string | undefined,
	placeholder?: string,
	options?: { filter?: (r: Repository) => Promise<boolean> },
): Promise<RepositoryQuickPickItem | undefined>;
export async function showRepositoryPicker(
	title: string | undefined,
	placeholder: string = 'Choose a repository',
	repositoriesOrOptions?: Repository[] | { filter?: (r: Repository) => Promise<boolean> },
): Promise<RepositoryQuickPickItem | undefined> {
	if (
		repositoriesOrOptions != null &&
		!Array.isArray(repositoriesOrOptions) &&
		repositoriesOrOptions.filter == null
	) {
		repositoriesOrOptions = undefined;
	}

	let items: RepositoryQuickPickItem[];
	if (repositoriesOrOptions == null || Array.isArray(repositoriesOrOptions)) {
		items = await Promise.all<Promise<RepositoryQuickPickItem>>([
			...map(repositoriesOrOptions ?? Container.instance.git.openRepositories, r =>
				createRepositoryQuickPickItem(r, undefined, { branch: true, status: true }),
			),
		]);
	} else {
		const { filter } = repositoriesOrOptions;
		items = await filterMapAsync(Container.instance.git.openRepositories, async r =>
			(await filter!(r))
				? createRepositoryQuickPickItem(r, undefined, { branch: true, status: true })
				: undefined,
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
		if (pick == null) return undefined;

		return pick;
	} finally {
		quickpick.dispose();
		disposables.forEach(d => void d.dispose());
	}
}
