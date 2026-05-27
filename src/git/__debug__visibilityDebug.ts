import type { Uri } from 'vscode';
import type { RepositoryVisibility } from '@gitlens/git/providers/types.js';
import type { GitProviderService, RepositoriesVisibility } from './gitProviderService.js';

export interface VisibilityDebugFacade {
	clearAccessCache: () => void;
	invalidateReposVisibilityCache: () => void;
	fireRepositoriesChanged: () => void;
}

let _override: RepositoryVisibility | undefined;
let _facade: VisibilityDebugFacade | undefined;

export function registerVisibilityDebug(svc: GitProviderService, facade: VisibilityDebugFacade): void {
	_facade = facade;

	const original = svc.visibility.bind(svc);
	(
		svc as unknown as {
			visibility: (repoPath?: string | Uri) => Promise<RepositoryVisibility | RepositoriesVisibility>;
		}
	).visibility = (repoPath?: string | Uri) => {
		if (_override != null) return Promise.resolve(_override);
		return original(repoPath as string);
	};
}

export function setSimulatedRepoVisibility(visibility: RepositoryVisibility | undefined): void {
	if (_override === visibility) return;

	_override = visibility;
	_facade?.clearAccessCache();
	_facade?.invalidateReposVisibilityCache();
	_facade?.fireRepositoriesChanged();
}

export function getSimulatedRepoVisibility(): RepositoryVisibility | undefined {
	return _override;
}
