import { Container } from '../../container';
import type { WebviewViewShowOptions } from '../../webviews/webviewsController';
import type { ShowCreateDraft, ShowViewDraft } from '../webviews/patchDetails/registration';

type ShowCreateOrOpen = ShowCreateDraft | ShowViewDraft;

export function showPatchesView(createOrOpen: ShowCreateOrOpen, options?: WebviewViewShowOptions): Promise<void> {
	if (createOrOpen.mode === 'create') {
		options = { ...options, preserveFocus: false, preserveVisibility: false };
	}
	return Container.instance.patchDetailsView.show(options, createOrOpen);
}
