import { Container } from '../../container';
import type { GitCommit } from '../../git/models/commit';
import type { GitRevisionReference } from '../../git/models/reference';

// TODO: just pass a patch or a cloud patch
export function showPatchesView(
	commit: GitRevisionReference | GitCommit,
	options?: { pin?: boolean; preserveFocus?: boolean; preserveVisibility?: boolean },
): Promise<void> {
	const { preserveFocus, ...opts } = { ...options, commit: commit };
	return Container.instance.patchDetailsView.show({ preserveFocus: preserveFocus }, opts);
}
