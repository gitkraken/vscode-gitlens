import type { RemoteProviderSupportedFeatures } from '@gitlens/git/models/remoteProvider.js';
import type { SupportedCloudIntegrationIds } from '@gitlens/integrations/constants.js';

export interface RepositoryShape {
	id: string;
	name: string;
	path: string;
	/** Common path of the repo family — present when `path` is a worktree (then `commonPath`
	 *  is the parent's path); absent for non-worktree repos (where `path` itself is the
	 *  family path). See {@link isSameRepoFamily} / {@link getRepoFamilyKey}. */
	commonPath?: string;
	uri: string;
	virtual: boolean;

	provider?: {
		name: string;
		icon?: string;
		integration?: { id: SupportedCloudIntegrationIds; connected: boolean };
		supportedFeatures: RemoteProviderSupportedFeatures;
		url?: string;
		bestRemoteName: string;
	};
}

/** The repo family key: a worktree's parent path, or the repo's own path when it isn't a worktree —
 *  see {@link RepositoryShape.commonPath}. Two repositories are in the same family when their keys match. */
export function getRepoFamilyKey(repo: Pick<RepositoryShape, 'path' | 'commonPath'>): string {
	return repo.commonPath ?? repo.path;
}

/** Whether `a` and `b` are the same repo family (a repo and its worktrees, or two sibling worktrees). */
export function isSameRepoFamily(
	a: Pick<RepositoryShape, 'path' | 'commonPath'>,
	b: Pick<RepositoryShape, 'path' | 'commonPath'>,
): boolean {
	return getRepoFamilyKey(a) === getRepoFamilyKey(b);
}
