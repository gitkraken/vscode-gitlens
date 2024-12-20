import { ThemeIcon } from 'vscode';
import type { IconPath } from '../../@types/vscode.iconpath';
import type { Container } from '../../container';
import { getIconPathUris } from '../../system/vscode/vscode';
import type { GitRemote } from './remote';
import { getRemoteThemeIconString } from './remote';

export function getRemoteIconPath(
	container: Container,
	remote: GitRemote | undefined,
	options?: { avatars?: boolean },
): IconPath {
	if (options?.avatars && remote?.provider?.icon != null) {
		return getIconPathUris(container, `icon-${remote.provider.icon}.svg`);
	}

	return new ThemeIcon(getRemoteThemeIconString(remote));
}
