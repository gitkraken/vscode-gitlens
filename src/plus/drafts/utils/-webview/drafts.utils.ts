import type { MessageItem } from 'vscode';
import { l10n, window } from 'vscode';
import { urls } from '../../../../constants.js';
import type { Container } from '../../../../container.js';
import { openUrl } from '../../../../system/-webview/vscode/uris.js';

export async function confirmDraftStorage(container: Container): Promise<boolean> {
	if (container.storage.get('confirm:draft:storage', false)) return true;

	while (true) {
		const accept: MessageItem = { title: l10n.t('Continue') };
		const decline: MessageItem = { title: l10n.t('Cancel'), isCloseAffordance: true };
		const moreInfo: MessageItem = { title: l10n.t('Learn More') };
		const security: MessageItem = { title: l10n.t('Security') };
		const result = await window.showInformationMessage(
			l10n.t(
				'Cloud Patches are securely stored by GitKraken and can be accessed by anyone with the link and a GitKraken account.',
			),
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
