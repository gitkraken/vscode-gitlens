import { Container } from '../../container';
import type { DraftSelectedEvent } from '../../eventBus';
import type { Change } from '../webviews/patchDetails/protocol';
import type { Draft, LocalDraft } from './draftsService';

interface ShowDraft {
	mode: 'draft';
	draft: LocalDraft | Draft;
}

interface ShowCreate {
	mode: 'create';
	changes: Change[];
}

type ShowPatches = ShowDraft | ShowCreate;

// TODO: just pass a patch or a draft
export function showPatchesView(
	draftOrChanges: ShowPatches,
	options?: { preserveFocus?: boolean; preserveVisibility?: boolean },
): Promise<void> {
	if (draftOrChanges.mode === 'create') {
		const { preserveFocus, ...opts } = { ...options, changes: draftOrChanges.changes } satisfies {
			preserveVisibility?: boolean;
			changes: Change[];
		};
		return Container.instance.patchDetailsView.show({ preserveFocus: true }, opts);
	}

	const { preserveFocus, ...opts } = { ...options, draft: draftOrChanges.draft } satisfies Partial<
		DraftSelectedEvent['data']
	>;
	return Container.instance.patchDetailsView.show({ preserveFocus: preserveFocus }, opts);
}
