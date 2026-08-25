import { some } from '@gitlens/utils/iterable.js';
import { GlRepository } from '../../../git/models/repository.js';
import type { Draft, DraftPatch } from '../../../plus/drafts/models/drafts.js';
import { serialize } from '../../../system/serialize.js';
import type { PatchDetails } from './protocol.js';

/**
 * Serializes a patch into its wire shape — stripping `contents`/`commit` (large payloads that ride
 * separately via the deferred draft-contents load) and reducing `repository` to the
 * `{ id, name, located }` triple the file tree renders.
 */
export function toPatchDetails(patch: DraftPatch): PatchDetails {
	const { commit: _commit, contents: _contents, repository, ...rest } = patch;
	return serialize({
		...rest,
		repository: {
			id: patch.gkRepositoryId,
			name: repository?.name ?? '',
			located: isRepoLocated(repository),
		},
	});
}

/** Whether a patch's repository has been resolved to an open repository (vs a remote identity). */
export function isRepoLocated(repo: DraftPatch['repository']): repo is GlRepository {
	return repo != null && GlRepository.is(repo);
}

/** Whether any patch of the draft still lacks its fetched contents/files/repository. */
export function isDraftMissingContent(draft: Draft): boolean {
	if (draft.changesets == null) return true;

	return some(draft.changesets, cs =>
		cs.patches.some(p => p.contents == null || p.files == null || p.repository == null),
	);
}
