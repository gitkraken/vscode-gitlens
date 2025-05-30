import type { MessageItem } from 'vscode';
import { window } from 'vscode';
import { Container } from '../../container';
import { configuration } from '../../system/configuration';
import type { WebviewViewShowOptions } from '../../webviews/webviewsController';
import type { ShowCreateDraft, ShowViewDraft } from '../webviews/patchDetails/registration';

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
	return Container.instance.patchDetailsView.show(options, createOrOpen);
}
