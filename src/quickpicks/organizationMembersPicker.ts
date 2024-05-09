import type { Disposable } from 'vscode';
import { window } from 'vscode';
import { getAvatarUri } from '../avatars';
import { ClearQuickInputButton } from '../commands/quickCommand.buttons';
import type { OrganizationMember } from '../plus/gk/account/organization';
import { debounce } from '../system/function';
import { defer } from '../system/promise';
import { sortCompare } from '../system/string';
import type { QuickPickItemOfT } from './items/common';

export async function showOrganizationMembersPicker(
	title: string,
	placeholder: string,
	members: OrganizationMember[] | Promise<OrganizationMember[]>,
	options?: {
		clearButton?: boolean;
		filter?: (member: OrganizationMember) => boolean;
		multiselect?: boolean;
		picked?: (member: OrganizationMember) => boolean;
	},
): Promise<OrganizationMember[] | undefined> {
	const deferred = defer<OrganizationMember[] | undefined>();
	const disposables: Disposable[] = [];

	type OrganizationMemberQuickPickItem = QuickPickItemOfT<OrganizationMember>;

	function sortItems(items: OrganizationMemberQuickPickItem[]) {
		return items.sort((a, b) => (a.picked ? -1 : 1) - (b.picked ? -1 : 1) || sortCompare(a.label, b.label));
	}

	try {
		const quickpick = window.createQuickPick<OrganizationMemberQuickPickItem>();
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

		quickpick.ignoreFocusOut = true;
		quickpick.title = title;
		quickpick.placeholder = placeholder;
		quickpick.matchOnDescription = true;
		quickpick.matchOnDetail = true;
		quickpick.canSelectMany = options?.multiselect ?? true;

		quickpick.buttons = options?.clearButton ? [ClearQuickInputButton] : [];

		quickpick.busy = true;
		quickpick.show();

		members = await members;
		if (options?.filter != null) {
			members = members.filter(options.filter);
		}

		if (!deferred.pending) return;

		const items = members.map(member => {
			const item: OrganizationMemberQuickPickItem = {
				label: member.name ?? member.username,
				description: member.email,
				picked: options?.picked?.(member) ?? false,
				item: member,
				iconPath: getAvatarUri(member.email, undefined),
			};

			item.alwaysShow = item.picked;
			return item;
		});

		if (!deferred.pending) return;

		quickpick.items = sortItems(items);
		if (quickpick.canSelectMany) {
			quickpick.selectedItems = items.filter(i => i.picked);
		} else {
			quickpick.activeItems = items.filter(i => i.picked);
		}

		quickpick.busy = false;

		disposables.push(
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
						quickpick.items = sortItems([...quickpick.items]);
						quickpick.selectedItems = e;
					}
				}, 10),
			),
		);

		const picks = await deferred.promise;
		return picks;
	} finally {
		disposables.forEach(d => void d.dispose());
	}
}
