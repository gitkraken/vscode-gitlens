import type { Disposable } from 'vscode';
import { window } from 'vscode';
import { ClearQuickInputButton } from '../commands/quickCommand.buttons';
import { GlyphChars, quickPickTitleMaxChars } from '../constants';
import type { Container } from '../container';
import type { GitContributor } from '../git/models/contributor';
import type { Repository } from '../git/models/repository';
import { defer } from '../system/promise';
import { pad, truncate } from '../system/string';
import { getQuickPickIgnoreFocusOut } from '../system/utils';
import type { ContributorQuickPickItem } from './items/gitCommands';
import { createContributorQuickPickItem } from './items/gitCommands';

export async function showContributorsPicker(
	container: Container,
	repository: Repository,
	title: string,
	placeholder: string,
	options?: {
		appendReposToTitle?: boolean;
		clearButton?: boolean;
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

		quickpick.ignoreFocusOut = getQuickPickIgnoreFocusOut();

		quickpick.title = options?.appendReposToTitle ? appendRepoToTitle(container, title, repository) : title;
		quickpick.placeholder = placeholder;
		quickpick.matchOnDescription = true;
		quickpick.matchOnDetail = true;
		quickpick.canSelectMany = options?.multiselect ?? true;

		quickpick.buttons = options?.clearButton ? [ClearQuickInputButton] : [];

		quickpick.busy = true;
		quickpick.show();

		const contributors = await repository.getContributors();
		if (!deferred.pending) return;

		const items = await Promise.all(
			contributors.map(c => createContributorQuickPickItem(c, options?.picked?.(c) ?? false)),
		);

		if (!deferred.pending) return;

		quickpick.items = items;
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
