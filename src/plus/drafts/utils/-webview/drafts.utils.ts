import type { MessageItem } from 'vscode';
import { window } from 'vscode';
import { urls } from '../../../../constants';
import type { Container } from '../../../../container';
import { openUrl } from '../../../../system/-webview/vscode/uris';

export async function confirmDraftStorage(container: Container): Promise<boolean> {
	if (container.storage.get('confirm:draft:storage', false)) return true;

	while (true) {
		const accept: MessageItem = { title: 'Continue' };
		const decline: MessageItem = { title: 'Cancel', isCloseAffordance: true };
		const moreInfo: MessageItem = { title: 'Learn More' };
		const security: MessageItem = { title: 'Security' };
		const result = await window.showInformationMessage(
			`Cloud Patches are securely stored by GitKraken and can be accessed by anyone with the link and a GitKraken account.`,
			{ modal: true },
			accept,
			moreInfo,
			security,
			decline,
		);

		if (result === accept) {
			void container.storage.store('confirm:draft:storage', true).catch();
			return true;
		}

		if (result === security) {
			void openUrl(urls.security);
			continue;
		}

		if (result === moreInfo) {
			void openUrl(urls.cloudPatches);
			continue;
		}

		return false;
	}
}
