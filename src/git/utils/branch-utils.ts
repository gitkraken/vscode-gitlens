import { ThemeIcon } from 'vscode';
import type { IconPath } from '../../@types/vscode.iconpath';
import type { Container } from '../../container';
import { getIconPathUris } from '../../system/vscode/vscode';
import type { GitBranch } from '../models/branch';

export function getBranchIconPath(container: Container, branch: GitBranch | undefined): IconPath {
	const status = branch?.status;
	switch (status) {
		case 'ahead':
		case 'behind':
		case 'diverged':
			return getIconPathUris(container, `icon-branch-${status}.svg`);
		case 'upToDate':
			return getIconPathUris(container, `icon-branch-synced.svg`);
		default:
			return new ThemeIcon('git-branch');
	}
}
