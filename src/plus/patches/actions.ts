import { Container } from '../../container';
import type { LocalPatch } from '../../git/models/patch';
import type { CloudPatch } from './cloudPatchService';

// TODO: just pass a patch or a cloud patch
export function showPatchesView(
	patch: LocalPatch | CloudPatch,
	options?: { preserveFocus?: boolean; preserveVisibility?: boolean },
): Promise<void> {
	const { preserveFocus, ...opts } = { ...options, patch: patch };
	return Container.instance.patchDetailsView.show({ preserveFocus: preserveFocus }, opts);
}
