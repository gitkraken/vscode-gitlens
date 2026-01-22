import type { Disposable } from 'vscode';
import { window } from 'vscode';
import { ClearQuickInputButton } from '../commands/quick-wizard/quickButtons.js';
import { GlyphChars, quickPickTitleMaxChars } from '../constants.js';
import type { Container } from '../container.js';
import type { GitContributor } from '../git/models/contributor.js';
import type { Repository } from '../git/models/repository.js';
import type { ContributorQuickPickItem } from '../git/utils/-webview/contributor.quickpick.js';
import { createContributorQuickPickItem } from '../git/utils/-webview/contributor.quickpick.js';
import { sortContributors } from '../git/utils/-webview/sorting.js';
import { getQuickPickIgnoreFocusOut } from '../system/-webview/vscode.js';
import { debounce } from '../system/function/debounce.js';
import { defer } from '../system/promise.js';
import { pad, truncate } from '../system/string.js';

export interface ContributorQuickPickOptions {
	appendReposToTitle?: boolean;
	clearButton?: boolean;
	ignoreFocusOut?: boolean;
	multiselect?: boolean;
	picked?: (contributor: GitContributor) => boolean;
}

export async function showContributorsPicker(
	container: Container,
	repository: Repository,
	title: string,
	placeholder: string,
	options?: ContributorQuickPickOptions,
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

		const contributors = await repository.git.contributors.getContributorsLite();
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
		: `${title}${truncate(`${pad(GlyphChars.Dot, 2, 2)}${repo.name}`, quickPickTitleMaxChars - title.length)}`;
}
