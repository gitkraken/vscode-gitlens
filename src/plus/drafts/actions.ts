import { Container } from '../../container';
import type { DraftSelectedEvent } from '../../eventBus';
import type { Draft, LocalDraft } from './draftsService';

// TODO: just pass a patch or a draft
export function showPatchesView(
	draft: LocalDraft | Draft,
	options?: { preserveFocus?: boolean; preserveVisibility?: boolean },
): Promise<void> {
	const { preserveFocus, ...opts } = { ...options, draft: draft } satisfies Partial<DraftSelectedEvent['data']>;
	return Container.instance.patchDetailsView.show({ preserveFocus: preserveFocus }, opts);
}
