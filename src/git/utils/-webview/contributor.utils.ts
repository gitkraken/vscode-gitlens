import { Uri } from 'vscode';
import type { GitContributor } from '@gitlens/git/models/contributor.js';
import { getAvatarUri } from '../../../avatars.js';
import type { GravatarDefaultStyle } from '../../../config.js';

export function getContributorAvatarUri(
	contributor: GitContributor,
	options?: { defaultStyle?: GravatarDefaultStyle; size?: number },
): Uri | Promise<Uri> {
	if (contributor.avatarUrl != null) return Uri.parse(contributor.avatarUrl);

	return getAvatarUri(contributor.email, undefined /*contributor.repoPath*/, options);
}
