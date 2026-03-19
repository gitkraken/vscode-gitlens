import type { QuickInputButton } from 'vscode';
import type { GitContributor } from '@gitlens/git/models/contributor.js';
import type { QuickPickItemOfT } from '../../../quickpicks/items/common.js';
import { configuration } from '../../../system/-webview/configuration.js';
import { getContributorAvatarUri } from './contributor.utils.js';

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
		iconPath: configuration.get('gitCommands.avatars') ? await getContributorAvatarUri(contributor) : undefined,
	};

	if (options?.alwaysShow == null && picked) {
		item.alwaysShow = true;
	}
	return item;
}
