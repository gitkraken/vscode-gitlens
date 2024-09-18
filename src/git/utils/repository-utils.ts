import type { IconPath } from '../../@types/vscode.iconpath';
import type { Container } from '../../container';
import { getIconPathUris } from '../../system/vscode/vscode';
import type { Repository } from '../models/repository';
import type { GitStatus } from '../models/status';

export function getRepositoryStatusIconPath(
	container: Container,
	repository: Repository,
	status: GitStatus | undefined,
): IconPath {
	const type = repository.virtual ? '-cloud' : '';

	if (status?.hasWorkingTreeChanges) {
		return getIconPathUris(container, `icon-repo-changes${type}.svg`);
	}

	const branchStatus = status?.branchStatus;
	switch (branchStatus) {
		case 'ahead':
		case 'behind':
		case 'diverged':
			return getIconPathUris(container, `icon-repo-${branchStatus}${type}.svg`);
		case 'upToDate':
			return getIconPathUris(container, `icon-repo-synced${type}.svg`);
		default:
			return getIconPathUris(container, `icon-repo${type}.svg`);
	}
}
