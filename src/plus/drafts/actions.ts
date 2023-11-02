import { Container } from '../../container';
import type { WebviewViewShowOptions } from '../../webviews/webviewsController';
import type { ShowCreateDraft, ShowOpenDraft } from '../webviews/patchDetails/registration';

type ShowCreateOrOpen = ShowCreateDraft | ShowOpenDraft;

export function showPatchesView(createOrOpen: ShowCreateOrOpen, options?: WebviewViewShowOptions): Promise<void> {
	if (createOrOpen.mode === 'create') {
		options = { ...options, preserveFocus: false, preserveVisibility: false };
	}
	return Container.instance.patchDetailsView.show(options, createOrOpen);
}
