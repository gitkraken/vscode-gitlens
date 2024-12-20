import type { Disposable } from 'vscode';
import { window } from 'vscode';
import { ClearQuickInputButton } from '../commands/quickCommand.buttons';
import { GlyphChars, quickPickTitleMaxChars } from '../constants';
import type { Container } from '../container';
import type { GitContributor } from '../git/models/contributor';
import type { ContributorQuickPickItem } from '../git/models/contributor.quickpick';
import { createContributorQuickPickItem } from '../git/models/contributor.quickpick';
import type { Repository } from '../git/models/repository';
import { sortContributors } from '../git/utils/sorting';
import { debounce } from '../system/function';
import { defer } from '../system/promise';
import { pad, truncate } from '../system/string';
import { getQuickPickIgnoreFocusOut } from '../system/vscode/utils';

export async function showContributorsPicker(
	container: Container,
	repository: Repository,
	title: string,
	placeholder: string,
	options?: {
		appendReposToTitle?: boolean;
		clearButton?: boolean;
		ignoreFocusOut?: boolean;
		multiselect?: boolean;
		picked?: (contributor: GitContributor) => boolean;
	},
): Promise<GitContributor[] | undefined> {
	const deferred = defer<GitContributor[] | undefined>();
	const disposables: Disposable[] = [];

	try {
		const quickpick = window.createQuickPick<ContributorQuickPickItem>();
		disposables.push(
			quickpick,
			quickpick.onDidHide(() => deferred.fulfill(undefined)),
			quickpick.onDidAccept(() =>
				!quickpick.busy ? deferred.fulfill(quickpick.selectedItems.map(c => c.item)) : undefined,
			),
			quickpick.onDidChangeSelection(
				debounce(e => {
					if (!quickpick.canSelectMany || quickpick.busy) return;

					let update = false;
					for (const item of quickpick.items) {
						const picked = e.includes(item);
						if (item.picked !== picked || item.alwaysShow !== picked) {
							item.alwaysShow = item.picked = picked;
							update = true;
						}
					}

					if (update) {
						quickpick.items = sortContributors([...quickpick.items]);
						quickpick.selectedItems = e;
					}
				}, 10),
			),
			quickpick.onDidTriggerButton(e => {
				if (e === ClearQuickInputButton) {
					if (quickpick.canSelectMany) {
						quickpick.selectedItems = [];
					} else {
						deferred.fulfill([]);
					}
				}
			}),
		);

		quickpick.ignoreFocusOut = options?.ignoreFocusOut ?? getQuickPickIgnoreFocusOut();

		quickpick.title = options?.appendReposToTitle ? appendRepoToTitle(container, title, repository) : title;
		quickpick.placeholder = placeholder;
		quickpick.matchOnDescription = true;
		quickpick.matchOnDetail = true;
		quickpick.canSelectMany = options?.multiselect ?? true;

		quickpick.buttons = options?.clearButton ? [ClearQuickInputButton] : [];

		quickpick.busy = true;
		quickpick.show();

		const contributors = await repository.git.getContributors();
		if (!deferred.pending) return;

		const items = await Promise.all(
			contributors.map(c => createContributorQuickPickItem(c, options?.picked?.(c) ?? false)),
		);

		if (!deferred.pending) return;

		quickpick.items = sortContributors(items);
		if (quickpick.canSelectMany) {
			quickpick.selectedItems = items.filter(i => i.picked);
		} else {
			quickpick.activeItems = items.filter(i => i.picked);
		}

		quickpick.busy = false;

		const picks = await deferred.promise;
		return picks;
	} finally {
		disposables.forEach(d => void d.dispose());
	}
}

function appendRepoToTitle(container: Container, title: string, repo: Repository) {
	return container.git.openRepositoryCount <= 1
		? title
		: `${title}${truncate(
				`${pad(GlyphChars.Dot, 2, 2)}${repo.formattedName}`,
				quickPickTitleMaxChars - title.length,
		  )}`;
}
