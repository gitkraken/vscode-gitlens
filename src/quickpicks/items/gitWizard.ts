import type { QuickInputButton, QuickPickItem } from 'vscode';
import { ThemeIcon } from 'vscode';
import type { GitWizardCommandArgs } from '../../commands/gitWizard';
import { getSteps } from '../../commands/quickWizard.utils';
import { GlyphChars } from '../../constants';
import { GlCommand } from '../../constants.commands';
import { Container } from '../../container';
import { emojify } from '../../emojis';
import type { GitBranch } from '../../git/models/branch';
import type { GitCommit, GitStashCommit } from '../../git/models/commit';
import { isStash } from '../../git/models/commit';
import type { GitReference } from '../../git/models/reference';
import { createReference } from '../../git/models/reference.utils';
import type { GitRemote } from '../../git/models/remote';
import { getRemoteUpstreamDescription } from '../../git/models/remote';
import type { Repository } from '../../git/models/repository';
import { isRevisionRange, shortenRevision } from '../../git/models/revision.utils';
import type { GitTag } from '../../git/models/tag';
import { getBranchIconPath, getWorktreeBranchIconPath } from '../../git/utils/icons';
import { fromNow } from '../../system/date';
import { pad } from '../../system/string';
import { configuration } from '../../system/vscode/configuration';
import type { QuickPickItemOfT } from './common';
import { CommandQuickPickItem } from './common';

export class GitWizardQuickPickItem extends CommandQuickPickItem<[GitWizardCommandArgs]> {
	constructor(label: string, args: GitWizardCommandArgs);
	constructor(item: QuickPickItem, args: GitWizardCommandArgs);
	constructor(labelOrItem: string | QuickPickItem, args: GitWizardCommandArgs) {
		super(labelOrItem, undefined, GlCommand.GitCommands, [args], { suppressKeyPress: true });
	}

	executeSteps(pickedVia: 'menu' | 'command') {
		return getSteps(Container.instance, this.args![0], pickedVia);
	}
}

export interface BranchQuickPickItem extends QuickPickItemOfT<GitBranch> {
	readonly current: boolean;
	readonly ref: string;
	readonly remote: boolean;
}

export async function createBranchQuickPickItem(
	branch: GitBranch,
	picked?: boolean,
	options?: {
		alwaysShow?: boolean;
		buttons?: QuickInputButton[];
		checked?: boolean;
		current?: boolean | 'checkmark';
		ref?: boolean;
		status?: boolean;
		type?: boolean | 'remote';
		worktree?: boolean;
	},
): Promise<BranchQuickPickItem> {
	let description = '';

	if (options?.type === true) {
		if (options.current === true && branch.current) {
			description = 'current branch';
		} else {
			description = 'branch';
		}
	} else if (options?.type === 'remote') {
		if (branch.remote) {
			description = 'remote branch';
		}
	} else if (options?.current === true && branch.current) {
		description = 'current branch';
	}

	if (options?.status && !branch.remote && branch.upstream != null) {
		let arrows = GlyphChars.Dash;

		if (!branch.upstream.missing) {
			const remote = await branch.getRemote();
			if (remote != null) {
				let left;
				let right;
				for (const { type } of remote.urls) {
					if (type === 'fetch') {
						left = true;

						if (right) break;
					} else if (type === 'push') {
						right = true;

						if (left) break;
					}
				}

				if (left && right) {
					arrows = GlyphChars.ArrowsRightLeft;
				} else if (right) {
					arrows = GlyphChars.ArrowRight;
				} else if (left) {
					arrows = GlyphChars.ArrowLeft;
				}
			}
		} else {
			arrows = GlyphChars.Warning;
		}

		const status = `${branch.getTrackingStatus({ suffix: `${GlyphChars.Space} ` })}${arrows}${GlyphChars.Space} ${
			branch.upstream.name
		}`;
		description = description ? `${description}${GlyphChars.Space.repeat(2)}${status}` : status;
	}

	if (options?.ref) {
		if (branch.sha) {
			description = description
				? `${description} $(git-commit)${GlyphChars.Space}${shortenRevision(branch.sha)}`
				: `$(git-commit)${GlyphChars.Space}${shortenRevision(branch.sha)}`;
		}

		if (branch.date !== undefined) {
			description = description
				? `${description}${pad(GlyphChars.Dot, 2, 2)}${branch.formattedDate}`
				: branch.formattedDate;
		}
	}

	const checked =
		options?.checked || (options?.checked == null && options?.current === 'checkmark' && branch.current);
	const item: BranchQuickPickItem = {
		label: checked ? `${branch.name}${pad('$(check)', 2)}` : branch.name,
		description: description,
		alwaysShow: options?.alwaysShow,
		buttons: options?.buttons,
		picked: picked ?? branch.current,
		item: branch,
		current: branch.current,
		ref: branch.name,
		remote: branch.remote,
		iconPath: branch.starred
			? new ThemeIcon('star-full')
			: options?.worktree
			  ? getWorktreeBranchIconPath(Container.instance, branch)
			  : getBranchIconPath(Container.instance, branch),
	};

	return item;
}

export class CommitLoadMoreQuickPickItem implements QuickPickItem {
	readonly label = 'Load more';
	readonly alwaysShow = true;
}

export type CommitQuickPickItem<T extends GitCommit = GitCommit> = QuickPickItemOfT<T>;

export async function createCommitQuickPickItem<T extends GitCommit = GitCommit>(
	commit: T,
	picked?: boolean,
	options?: { alwaysShow?: boolean; buttons?: QuickInputButton[]; compact?: boolean; icon?: boolean | 'avatar' },
) {
	if (isStash(commit)) {
		return createStashQuickPickItem(commit, picked, {
			...options,
			icon: options?.icon === 'avatar' ? true : options?.icon,
		});
	}

	let iconPath;
	if (options?.icon === 'avatar') {
		if (configuration.get('gitCommands.avatars')) {
			iconPath = await commit.getAvatarUri();
		} else {
			options.icon = true;
		}
	}

	if (options?.icon === true) {
		iconPath = new ThemeIcon('git-commit');
	}

	if (options?.compact) {
		const item: CommitQuickPickItem<T> = {
			label: commit.summary,
			description: `${commit.author.name}, ${commit.formattedDate}${pad('$(git-commit)', 2, 1)}${
				commit.shortSha
			}${pad(GlyphChars.Dot, 2, 2)}${commit.formatStats('short')}`,
			alwaysShow: options.alwaysShow,
			buttons: options.buttons,
			picked: picked,
			item: commit,
			iconPath: iconPath,
		};
		return item;
	}

	const item: CommitQuickPickItem<T> = {
		label: commit.summary,
		description: '',
		detail: `${GlyphChars.Space.repeat(2)}${commit.author.name}, ${commit.formattedDate}${pad(
			'$(git-commit)',
			2,
			1,
		)}${commit.shortSha}${pad(GlyphChars.Dot, 2, 2)}${commit.formatStats('short')}`,
		alwaysShow: options?.alwaysShow,
		buttons: options?.buttons,
		picked: picked,
		item: commit,
		iconPath: iconPath,
	};
	return item;
}

export function createStashQuickPickItem(
	stash: GitStashCommit,
	picked?: boolean,
	options?: { alwaysShow?: boolean; buttons?: QuickInputButton[]; compact?: boolean; icon?: boolean },
) {
	const number = stash.number == null ? '' : `${stash.number}: `;

	if (options?.compact) {
		const item: CommitQuickPickItem<GitStashCommit> = {
			label: `${number}${stash.summary}`,
			description: `${stash.formattedDate}${pad(GlyphChars.Dot, 2, 2)}${stash.formatStats('short')}`,
			alwaysShow: options.alwaysShow,
			buttons: options.buttons,
			picked: picked,
			item: stash,
			iconPath: options.icon ? new ThemeIcon('archive') : undefined,
		};

		return item;
	}

	const item: CommitQuickPickItem<GitStashCommit> = {
		label: `${number}${stash.summary}`,
		description: '',
		detail: `${GlyphChars.Space.repeat(2)}${stash.formattedDate}${pad(GlyphChars.Dot, 2, 2)}${stash.formatStats(
			'short',
		)}`,
		alwaysShow: options?.alwaysShow,
		buttons: options?.buttons,
		picked: picked,
		item: stash,
		iconPath: options?.icon ? new ThemeIcon('archive') : undefined,
	};

	return item;
}

export interface RefQuickPickItem extends QuickPickItemOfT<GitReference> {
	readonly current: boolean;
	readonly ref: string;
	readonly remote: boolean;
}

export function createRefQuickPickItem(
	ref: string | GitReference,
	repoPath: string,
	picked?: boolean,
	options?: { alwaysShow?: boolean; buttons?: QuickInputButton[]; icon?: boolean; ref?: boolean },
): RefQuickPickItem {
	if (ref === '') {
		return {
			label: 'Working Tree',
			description: '',
			alwaysShow: options?.alwaysShow,
			buttons: options?.buttons,
			picked: picked,
			item: createReference(ref, repoPath, { refType: 'revision', name: 'Working Tree' }),
			current: false,
			ref: ref,
			remote: false,
			iconPath: options?.icon ? new ThemeIcon('file-directory') : undefined,
		};
	}

	if (ref === 'HEAD') {
		return {
			label: 'HEAD',
			description: '',
			alwaysShow: options?.alwaysShow,
			buttons: options?.buttons,
			picked: picked,
			item: createReference(ref, repoPath, { refType: 'revision', name: 'HEAD' }),
			current: false,
			ref: ref,
			remote: false,
			iconPath: options?.icon ? new ThemeIcon('git-branch') : undefined,
		};
	}

	let gitRef;
	if (typeof ref === 'string') {
		gitRef = createReference(ref, repoPath);
	} else {
		gitRef = ref;
		ref = gitRef.ref;
	}

	if (isRevisionRange(ref)) {
		return {
			label: `Range ${gitRef.name}`,
			description: '',
			alwaysShow: options?.alwaysShow,
			buttons: options?.buttons,
			picked: picked,
			item: gitRef,
			current: false,
			ref: ref,
			remote: false,
		};
	}

	const item: RefQuickPickItem = {
		label: `Commit ${gitRef.name}`,
		description: options?.ref ? `$(git-commit)${GlyphChars.Space}${ref}` : '',
		alwaysShow: options?.alwaysShow,
		buttons: options?.buttons,
		picked: picked,
		item: gitRef,
		current: false,
		ref: ref,
		remote: false,
	};

	return item;
}

export type RemoteQuickPickItem = QuickPickItemOfT<GitRemote>;

export function createRemoteQuickPickItem(
	remote: GitRemote,
	picked?: boolean,
	options?: {
		alwaysShow?: boolean;
		buttons?: QuickInputButton[];
		checked?: boolean;
		type?: boolean;
		upstream?: boolean;
	},
) {
	let description = '';
	if (options?.type) {
		description = 'remote';
	}

	if (options?.upstream) {
		const upstream = getRemoteUpstreamDescription(remote);
		description = description ? `${description}${pad(GlyphChars.Dot, 2, 2)}${upstream}` : upstream;
	}

	const item: RemoteQuickPickItem = {
		label: options?.checked ? `${remote.name}${pad('$(check)', 2)}` : remote.name,
		description: description,
		alwaysShow: options?.alwaysShow,
		buttons: options?.buttons,
		picked: picked,
		item: remote,
		iconPath: new ThemeIcon('cloud'),
	};

	return item;
}

export interface RepositoryQuickPickItem extends QuickPickItemOfT<Repository> {
	readonly repoPath: string;
}

export async function createRepositoryQuickPickItem(
	repository: Repository,
	picked?: boolean,
	options?: {
		alwaysShow?: boolean;
		branch?: boolean;
		buttons?: QuickInputButton[];
		fetched?: boolean;
		status?: boolean;
	},
) {
	let repoStatus;
	if (options?.branch || options?.status) {
		repoStatus = await repository.git.getStatus();
	}

	let description = '';
	if (options?.branch && repoStatus != null) {
		description = repoStatus.branch;
	}

	if (options?.status && repoStatus != null) {
		let workingStatus = '';
		if (repoStatus.files.length !== 0) {
			workingStatus = repoStatus.getFormattedDiffStatus({
				compact: true,
				prefix: pad(GlyphChars.Dot, 2, 2),
			});
		}

		const upstreamStatus = repoStatus.getUpstreamStatus({
			prefix: description ? `${GlyphChars.Space} ` : '',
		});

		const status = `${upstreamStatus}${workingStatus}`;
		if (status) {
			description = description ? `${description}${status}` : status;
		}
	}

	if (options?.fetched) {
		const lastFetched = await repository.getLastFetched();
		if (lastFetched !== 0) {
			const fetched = `Last fetched ${fromNow(new Date(lastFetched))}`;
			description = description ? `${description}${pad(GlyphChars.Dot, 2, 2)}${fetched}` : fetched;
		}
	}

	const item: RepositoryQuickPickItem = {
		label: repository.formattedName,
		description: description,
		alwaysShow: options?.alwaysShow,
		buttons: options?.buttons,
		picked: picked,
		item: repository,
		repoPath: repository.path,
	};

	return item;
}

export interface TagQuickPickItem extends QuickPickItemOfT<GitTag> {
	readonly current: boolean;
	readonly ref: string;
	readonly remote: boolean;
}

export function createTagQuickPickItem(
	tag: GitTag,
	picked?: boolean,
	options?: {
		alwaysShow?: boolean;
		buttons?: QuickInputButton[];
		checked?: boolean;
		message?: boolean;
		ref?: boolean;
		type?: boolean;
	},
) {
	let description = '';
	if (options?.type) {
		description = 'tag';
	}

	if (options?.ref) {
		description = `${description}${pad('$(git-commit)', description ? 2 : 0, 1)}${shortenRevision(tag.sha)}`;

		description = `${description ? `${description}${pad(GlyphChars.Dot, 2, 2)}` : ''}${tag.formattedDate}`;
	}

	if (options?.message) {
		const message = emojify(tag.message);
		description = description ? `${description}${pad(GlyphChars.Dot, 2, 2)}${message}` : message;
	}

	const item: TagQuickPickItem = {
		label: options?.checked ? `${tag.name}${pad('$(check)', 2)}` : tag.name,
		description: description,
		alwaysShow: options?.alwaysShow,
		buttons: options?.buttons,
		picked: picked,
		item: tag,
		current: false,
		ref: tag.name,
		remote: false,
		iconPath: new ThemeIcon('tag'),
	};

	return item;
}
