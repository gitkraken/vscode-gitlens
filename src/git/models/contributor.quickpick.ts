import type { QuickInputButton } from 'vscode';
import type { QuickPickItemOfT } from '../../quickpicks/items/common';
import { configuration } from '../../system/vscode/configuration';
import type { GitContributor } from './contributor';

export type ContributorQuickPickItem = QuickPickItemOfT<GitContributor>;

export async function createContributorQuickPickItem(
	contributor: GitContributor,
	picked?: boolean,
	options?: { alwaysShow?: boolean; buttons?: QuickInputButton[] },
): Promise<ContributorQuickPickItem> {
	const item: ContributorQuickPickItem = {
		label: contributor.label,
		description: contributor.current ? 'you' : contributor.email,
		alwaysShow: options?.alwaysShow,
		buttons: options?.buttons,
		picked: picked,
		item: contributor,
		iconPath: configuration.get('gitCommands.avatars') ? await contributor.getAvatarUri() : undefined,
	};

	if (options?.alwaysShow == null && picked) {
		item.alwaysShow = true;
	}
	return item;
}
