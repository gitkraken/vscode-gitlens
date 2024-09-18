import type { IconPath } from '../../@types/vscode.iconpath';
import type { Container } from '../../container';
import { getIconPathUris } from '../../system/vscode/vscode';
import type { GitBranch } from '../models/branch';

export function getWorktreeBranchIconPath(container: Container, branch: GitBranch | undefined): IconPath {
	const status = branch?.status;
	switch (status) {
		case 'ahead':
		case 'behind':
		case 'diverged':
			return getIconPathUris(container, `icon-repo-${status}.svg`);
		case 'upToDate':
			return getIconPathUris(container, `icon-repo-synced.svg`);
		default:
			return getIconPathUris(container, `icon-repo.svg`);
	}
}
