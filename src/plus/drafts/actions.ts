import type { MessageItem } from 'vscode';
import { window } from 'vscode';
import { Container } from '../../container.js';
import { configuration } from '../../system/-webview/configuration.js';
import type { ShowCreateDraft, ShowViewDraft } from '../../webviews/plus/patchDetails/registration.js';
import type { WebviewViewShowOptions } from '../../webviews/webviewsController.js';

type ShowCreateOrOpen = ShowCreateDraft | ShowViewDraft;

export async function showPatchesView(createOrOpen: ShowCreateOrOpen, options?: WebviewViewShowOptions): Promise<void> {
	if (!configuration.get('cloudPatches.enabled')) {
		const confirm: MessageItem = { title: 'Enable' };
		const cancel: MessageItem = { title: 'Cancel', isCloseAffordance: true };
		const result = await window.showInformationMessage(
			'Cloud Patches are currently disabled. Would you like to enable them?',
			{ modal: true },
			confirm,
			cancel,
		);

		if (result !== confirm) return;
		await configuration.updateEffective('cloudPatches.enabled', true);
	}

	if (createOrOpen.mode === 'create') {
		options = { ...options, preserveFocus: false, preserveVisibility: false };
	}
	return Container.instance.views.patchDetails.show(options, createOrOpen);
}
