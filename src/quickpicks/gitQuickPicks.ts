'use strict';
import { QuickPickItem } from 'vscode';
import { GlyphChars } from '../constants';
import { Dates, Strings } from '../system';
import {
	GitBranch,
	GitContributor,
	GitLogCommit,
	GitReference,
	GitRemoteType,
	GitService,
	GitStashCommit,
	GitTag,
	Repository
} from '../git/gitService';
import { emojify } from '../emojis';

export interface QuickPickItemOfT<T = any> extends QuickPickItem {
	readonly item: T;
}

export interface FlagsQuickPickItem<T> extends QuickPickItemOfT<T[]> {}
export namespace FlagsQuickPickItem {
	export function create<T>(flags: T[], item: T[], options: QuickPickItem) {
		return { ...options, item: item, picked: hasFlags(flags, item) };
	}
}

function hasFlags<T>(flags: T[], has?: T | T[]): boolean {
	if (has === undefined) return flags.length === 0;
	if (!Array.isArray(has)) return flags.includes(has);

	return has.length === 0 ? flags.length === 0 : has.every(f => flags.includes(f));
}

export enum Directive {
	Back = 'Back',
	Cancel = 'Cancel'
}

export interface DirectiveQuickPickItem extends QuickPickItem {
	directive: Directive;
}

export namespace DirectiveQuickPickItem {
	export function create(
		directive: Directive,
		picked?: boolean,
		options: { label?: string; description?: string; detail?: string } = {}
	) {
		const item: DirectiveQuickPickItem = {
			label: options.label || directive,
			description: options.description || '',
			detail: options.detail,
			alwaysShow: true,
			picked: picked,
			directive: directive
		};

		return item;
	}

	export function is(item: QuickPickItem): item is DirectiveQuickPickItem {
		return item != null && 'directive' in item;
	}
}

export interface BranchQuickPickItem extends QuickPickItemOfT<GitBranch> {
	readonly current: boolean;
	readonly ref: string;
	readonly remote: boolean;
}

export namespace BranchQuickPickItem {
	export async function create(
		branch: GitBranch,
		picked?: boolean,
		options: {
			alwaysShow?: boolean;
			current?: boolean | 'checkmark';
			checked?: boolean;
			ref?: boolean;
			status?: boolean;
			type?: boolean | 'remote';
		} = {}
	) {
		let description = '';
		if (options.type === true) {
			if (options.current === true && branch.current) {
				description = 'current branch';
			} else {
				description = 'branch';
			}
		} else if (options.type === 'remote') {
			if (branch.remote) {
				description = 'remote branch';
			}
		} else if (options.current === true && branch.current) {
			description = 'current branch';
		}

		if (options.status && !branch.remote && branch.tracking !== undefined) {
			let arrows = GlyphChars.Dash;

			const remote = await branch.getRemote();
			if (remote !== undefined) {
				let left;
				let right;
				for (const { type } of remote.types) {
					if (type === GitRemoteType.Fetch) {
						left = true;

						if (right) break;
					} else if (type === GitRemoteType.Push) {
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

			const status = `${branch.getTrackingStatus({ suffix: `${GlyphChars.Space} ` })}${arrows}${
				GlyphChars.Space
			} ${branch.tracking}`;
			description = `${description ? `${description}${GlyphChars.Space.repeat(2)}${status}` : status}`;
		}

		if (options.ref) {
			if (branch.sha) {
				description = description
					? `${description}${Strings.pad('$(git-commit)', 2, 2)}${GitService.shortenSha(branch.sha)}`
					: `${Strings.pad('$(git-commit)', 0, 2)}${GitService.shortenSha(branch.sha)}`;
			}

			if (branch.date !== undefined) {
				description = description
					? `${description}${Strings.pad(GlyphChars.Dot, 2, 2)}${branch.formattedDate}`
					: branch.formattedDate;
			}
		}

		const checked =
			options.checked || (options.checked === undefined && options.current === 'checkmark' && branch.current);
		const item: BranchQuickPickItem = {
			label: `${GlyphChars.SpaceThin}${Strings.pad('$(git-branch)', 0, 2)}${GlyphChars.SpaceThinnest}${
				branch.name
			}${checked ? `${GlyphChars.Space.repeat(2)}$(check)${GlyphChars.Space}` : ''}`,
			description: description,
			alwaysShow: options.alwaysShow,
			picked: picked === undefined ? branch.current : picked,
			item: branch,
			current: branch.current,
			ref: branch.name,
			remote: branch.remote
		};

		return item;
	}
}

export interface CommitQuickPickItem<T extends GitLogCommit = GitLogCommit> extends QuickPickItemOfT<T> {}

export namespace CommitQuickPickItem {
	export function create<T extends GitLogCommit = GitLogCommit>(
		commit: T,
		picked?: boolean,
		options: { alwaysShow?: boolean; compact?: boolean; icon?: boolean } = {}
	) {
		if (GitStashCommit.is(commit)) {
			const number = commit.number === undefined ? '' : `${commit.number}: `;

			if (options.compact) {
				const item: CommitQuickPickItem<T> = {
					label: `${number}${commit.getShortMessage()}`,
					description: `${commit.formattedDate}${Strings.pad(
						GlyphChars.Dot,
						2,
						2
					)}${commit.getFormattedDiffStatus({ compact: true })}`,
					alwaysShow: options.alwaysShow,
					picked: picked,
					item: commit
				};

				return item;
			}

			const item: CommitQuickPickItem<T> = {
				label: `${number}${commit.getShortMessage()}`,
				description: '',
				detail: `${GlyphChars.Space.repeat(2)}${commit.formattedDate}${Strings.pad(
					GlyphChars.Dot,
					2,
					2
				)}${commit.getFormattedDiffStatus({ compact: true })}`,
				alwaysShow: options.alwaysShow,
				picked: picked,
				item: commit
			};

			return item;
		}

		if (options.compact) {
			const item: CommitQuickPickItem<T> = {
				label: `${options.icon ? Strings.pad('$(git-commit)', 0, 2) : ''}${commit.getShortMessage()}`,
				description: `${commit.author}, ${commit.formattedDate}${Strings.pad('$(git-commit)', 2, 2)}${
					commit.shortSha
				}${Strings.pad(GlyphChars.Dot, 2, 2)}${commit.getFormattedDiffStatus({ compact: true })}`,
				alwaysShow: options.alwaysShow,
				picked: picked,
				item: commit
			};
			return item;
		}

		const item: CommitQuickPickItem<T> = {
			label: `${options.icon ? Strings.pad('$(git-commit)', 0, 2) : ''}${commit.getShortMessage()}`,
			description: '',
			detail: `${GlyphChars.Space.repeat(2)}${commit.author}, ${commit.formattedDate}${Strings.pad(
				'$(git-commit)',
				2,
				2
			)}${commit.shortSha}${Strings.pad(GlyphChars.Dot, 2, 2)}${commit.getFormattedDiffStatus({
				compact: true
			})}`,
			alwaysShow: options.alwaysShow,
			picked: picked,
			item: commit
		};
		return item;
	}
}

export interface ContributorQuickPickItem extends QuickPickItemOfT<GitContributor> {}

export namespace ContributorQuickPickItem {
	export function create(
		contributor: GitContributor,
		picked?: boolean,
		options: { alwaysShow?: boolean } = {}
	): ContributorQuickPickItem {
		const item: ContributorQuickPickItem = {
			label: contributor.name,
			description: contributor.email,
			alwaysShow: options.alwaysShow,
			picked: picked,
			item: contributor
		};
		return item;
	}
}

export interface RefQuickPickItem extends QuickPickItemOfT<GitReference> {
	readonly current: boolean;
	readonly ref: string;
	readonly remote: boolean;
}

export namespace RefQuickPickItem {
	export function create(
		ref: string,
		picked?: boolean,
		options: { alwaysShow?: boolean; ref?: boolean } = {}
	): RefQuickPickItem {
		if (ref === '') {
			return {
				label: `${Strings.pad('$(file-directory)', 0, 2)}Working Tree`,
				description: '',
				alwaysShow: options.alwaysShow,
				picked: picked,
				item: GitReference.create(ref, { name: 'Working Tree' }),
				current: false,
				ref: ref,
				remote: false
			};
		}

		if (ref === 'HEAD') {
			return {
				label: 'HEAD',
				description: '',
				alwaysShow: options.alwaysShow,
				picked: picked,
				item: GitReference.create(ref, { name: 'HEAD' }),
				current: false,
				ref: ref,
				remote: false
			};
		}

		const gitRef = GitReference.create(ref);

		const item: RefQuickPickItem = {
			label: `Commit ${gitRef.name}`,
			description: options.ref ? `$(git-commit) ${ref}` : '',
			alwaysShow: options.alwaysShow,
			picked: picked,
			item: gitRef,
			current: false,
			ref: ref,
			remote: false
		};

		return item;
	}
}

export interface RepositoryQuickPickItem extends QuickPickItemOfT<Repository> {
	readonly repoPath: string;
}

export namespace RepositoryQuickPickItem {
	export async function create(
		repository: Repository,
		picked?: boolean,
		options: { alwaysShow?: boolean; branch?: boolean; fetched?: boolean; status?: boolean } = {}
	) {
		let repoStatus;
		if (options.branch || options.status) {
			repoStatus = await repository.getStatus();
		}

		let description = '';
		if (options.branch && repoStatus) {
			description = repoStatus.branch;
		}

		if (options.status && repoStatus) {
			let workingStatus = '';
			if (repoStatus.files.length !== 0) {
				workingStatus = repoStatus.getFormattedDiffStatus({
					compact: true,
					prefix: Strings.pad(GlyphChars.Dot, 2, 2)
				});
			}

			const upstreamStatus = repoStatus.getUpstreamStatus({
				prefix: description ? `${GlyphChars.Space} ` : ''
			});

			const status = `${upstreamStatus}${workingStatus}`;
			if (status) {
				description = `${description ? `${description}${status}` : status}`;
			}
		}

		if (options.fetched) {
			const lastFetched = await repository.getLastFetched();
			if (lastFetched !== 0) {
				const fetched = `Last fetched ${Dates.getFormatter(new Date(lastFetched)).fromNow()}`;
				description = `${
					description ? `${description}${Strings.pad(GlyphChars.Dot, 2, 2)}${fetched}` : fetched
				}`;
			}
		}

		const item: RepositoryQuickPickItem = {
			label: repository.formattedName,
			description: description,
			alwaysShow: options.alwaysShow,
			picked: picked,
			item: repository,
			repoPath: repository.path
		};

		return item;
	}
}

export interface TagQuickPickItem extends QuickPickItemOfT<GitTag> {
	readonly current: boolean;
	readonly ref: string;
	readonly remote: boolean;
}

export namespace TagQuickPickItem {
	export function create(
		tag: GitTag,
		picked?: boolean,
		options: {
			alwaysShow?: boolean;
			message?: boolean;
			checked?: boolean;
			ref?: boolean;
			type?: boolean;
		} = {}
	) {
		let description = '';
		if (options.type) {
			description = 'tag';
		}

		if (options.ref) {
			description = description
				? `${description}${Strings.pad('$(git-commit)', 2, 2)}${GitService.shortenSha(tag.sha)}`
				: `${Strings.pad('$(git-commit)', 0, 2)}${GitService.shortenSha(tag.sha)}`;

			description = description
				? `${description}${Strings.pad(GlyphChars.Dot, 2, 2)}${tag.formattedDate}`
				: tag.formattedDate;
		}

		if (options.message) {
			const message = emojify(tag.message);
			description = description ? `${description}${Strings.pad(GlyphChars.Dot, 2, 2)}${message}` : message;
		}

		const item: TagQuickPickItem = {
			label: `${Strings.pad('$(tag)', 0, 2)}${tag.name}${
				options.checked ? `${GlyphChars.Space.repeat(2)}$(check)${GlyphChars.Space}` : ''
			}`,
			description: description,
			alwaysShow: options.alwaysShow,
			picked: picked,
			item: tag,
			current: false,
			ref: tag.name,
			remote: false
		};

		return item;
	}
}
