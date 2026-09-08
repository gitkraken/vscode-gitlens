import * as l10n from '@vscode/l10n';
import { getBranchNameWithoutRemote, getRemoteNameFromBranchName } from '@gitlens/utils/gitRefs.js';
import type {
	GitBranchReference,
	GitReference,
	GitRevisionReference,
	GitStashReference,
	GitTagReference,
} from '../models/reference.js';
import { isRevisionRange, isShaWithParentSuffix, shortenRevision } from './revision.utils.js';

interface GitBranchReferenceOptions {
	refType: 'branch';
	id?: string;
	name: string;
	remote: boolean;
	sha?: string;
	upstream?: { name: string; missing: boolean };
	worktree?: { path: string; isDefault: boolean } | boolean;
}

interface GitCommitReferenceOptions {
	refType: 'revision';
	name?: string;
	message?: string;
}

interface GitStashReferenceOptions {
	refType: 'stash';
	name: string;
	number: string | undefined;
	message?: string;
	stashOnRef?: string;
}

interface GitTagReferenceOptions {
	refType: 'tag';
	id?: string;
	name: string;
	sha?: string;
}

export function createReference(ref: string, repoPath: string, options: GitBranchReferenceOptions): GitBranchReference;
export function createReference(ref: string, repoPath: string, options: GitStashReferenceOptions): GitStashReference;
export function createReference(ref: string, repoPath: string, options: GitTagReferenceOptions): GitTagReference;
export function createReference(
	ref: string,
	repoPath: string,
	options?: GitCommitReferenceOptions,
): GitRevisionReference;
export function createReference(
	ref: string,
	repoPath: string,
	options:
		| GitBranchReferenceOptions
		| GitStashReferenceOptions
		| GitTagReferenceOptions
		| GitCommitReferenceOptions = { refType: 'revision' },
): GitReference {
	switch (options.refType) {
		case 'branch':
			return {
				refType: 'branch',
				repoPath: repoPath,
				ref: ref,
				name: options.name,
				id: options.id,
				remote: options.remote,
				sha: options.sha,
				upstream: options.upstream,
				worktree: options.worktree,
			};
		case 'stash':
			return {
				refType: 'stash',
				repoPath: repoPath,
				ref: ref,
				sha: ref,
				name: options.name,
				stashNumber: options.number,
				message: options.message,
				stashOnRef: options.stashOnRef,
			};
		case 'tag':
			return {
				refType: 'tag',
				repoPath: repoPath,
				ref: ref,
				name: options.name,
				id: options.id,
				sha: options.sha,
			};
		default:
			return {
				refType: 'revision',
				repoPath: repoPath,
				ref: ref,
				sha: ref,
				name:
					options.name ??
					shortenRevision(ref, {
						strings: {
							uncommitted: l10n.t('Working Tree'),
							uncommittedStaged: l10n.t('Index'),
							working: l10n.t('Working Tree'),
						},
					}),
				message: options.message,
			};
	}
}

export function getReferenceNameWithoutRemote(ref: GitReference): string {
	if (ref.refType === 'branch') {
		return ref.remote ? getBranchNameWithoutRemote(ref.name) : ref.name;
	}
	return ref.name;
}

export function getReferenceTypeLabel(ref: GitReference | undefined): string {
	switch (ref?.refType) {
		case 'branch':
			return l10n.t('Branch');
		case 'stash':
			return l10n.t('Stash');
		case 'tag':
			return l10n.t('Tag');
		default:
			return l10n.t('Commit');
	}
}

export function isBranchReference(ref: GitReference | undefined): ref is GitBranchReference {
	return ref?.refType === 'branch';
}

export function isGitReference(ref: unknown): ref is GitReference {
	if (ref == null || typeof ref !== 'object') return false;

	const r = ref as GitReference;
	return (
		typeof r.refType === 'string' &&
		typeof r.repoPath === 'string' &&
		typeof r.ref === 'string' &&
		typeof r.name === 'string'
	);
}

export function isRevisionReference(ref: GitReference | undefined): ref is GitRevisionReference {
	return ref?.refType === 'revision';
}

export function isRevisionRangeReference(ref: GitReference | undefined): ref is GitRevisionReference {
	return ref?.refType === 'revision' && isRevisionRange(ref.ref);
}

export function isStashReference(ref: GitReference | undefined): ref is GitStashReference {
	return ref?.refType === 'stash' || (ref?.refType === 'revision' && Boolean('stashName' in ref && ref.stashName));
}

export function isTagReference(ref: GitReference | undefined): ref is GitTagReference {
	return ref?.refType === 'tag';
}

export function getReferenceLabel(
	refs: GitReference | GitReference[] | undefined,
	options?: { capitalize?: boolean; expand?: boolean; icon?: boolean; label?: boolean; quoted?: boolean } | false,
): string {
	if (refs == null) return '';

	options =
		options === false
			? {}
			: { expand: true, icon: true, label: options?.label ?? options?.expand ?? true, ...options };

	let result;
	if (!Array.isArray(refs) || refs.length === 1) {
		const ref = Array.isArray(refs) ? refs[0] : refs;
		let refName = options?.quoted ? `'${ref.name}'` : ref.name;
		switch (ref.refType) {
			case 'branch': {
				if (ref.remote) {
					refName = `${getRemoteNameFromBranchName(refName)}: ${getBranchNameWithoutRemote(refName)}`;
					refName = options?.quoted ? `'${refName}'` : refName;
				}

				if (options.label) {
					if (options.icon) {
						if (options.capitalize && options.expand) {
							result = ref.remote
								? l10n.t('Remote Branch $(git-branch)\u00a0{0}', refName)
								: l10n.t('Branch $(git-branch)\u00a0{0}', refName);
						} else {
							result = ref.remote
								? l10n.t('remote branch $(git-branch)\u00a0{0}', refName)
								: l10n.t('branch $(git-branch)\u00a0{0}', refName);
						}
					} else if (options.capitalize && options.expand) {
						result = ref.remote ? l10n.t('Remote Branch {0}', refName) : l10n.t('Branch {0}', refName);
					} else {
						result = ref.remote ? l10n.t('remote branch {0}', refName) : l10n.t('branch {0}', refName);
					}
				} else {
					result = options.icon ? `$(git-branch)\u00a0${refName}` : refName;
				}
				break;
			}
			case 'tag':
				if (options.label) {
					if (options.icon) {
						result =
							options.capitalize && options.expand
								? l10n.t('Tag $(tag)\u00a0{0}', refName)
								: l10n.t('tag $(tag)\u00a0{0}', refName);
					} else {
						result =
							options.capitalize && options.expand
								? l10n.t('Tag {0}', refName)
								: l10n.t('tag {0}', refName);
					}
				} else {
					result = options.icon ? `$(tag)\u00a0${refName}` : refName;
				}
				break;
			default: {
				if (isStashReference(ref)) {
					let message;
					if (options.expand && ref.message) {
						message = `${ref.stashNumber != null ? `#${ref.stashNumber}: ` : ''}${
							ref.message.length > 20 ? `${ref.message.substring(0, 20).trimEnd()}\u2026` : ref.message
						}`;
					}

					const stashName = message ?? (ref.stashNumber ? `#${ref.stashNumber}` : ref.name);
					if (options.label) {
						if (options.icon) {
							result =
								options.capitalize && options.expand
									? l10n.t('Stash $(archive)\u00a0{0}', message ?? ref.name)
									: l10n.t('stash $(archive)\u00a0{0}', message ?? ref.name);
						} else {
							result =
								options.capitalize && options.expand
									? l10n.t('Stash {0}', stashName)
									: l10n.t('stash {0}', stashName);
						}
					} else {
						result = options.icon ? `$(archive)\u00a0${message ?? ref.name}` : stashName;
					}
				} else if (isRevisionRange(ref.ref)) {
					result = refName;
				} else {
					let message;
					if (options.expand && ref.message) {
						message =
							ref.message.length > 20
								? ` (${ref.message.substring(0, 20).trimEnd()}\u2026)`
								: ` (${ref.message})`;
					}

					let before = false;
					if (options.expand && options.label && isShaWithParentSuffix(ref.ref)) {
						refName = ref.name.endsWith('^') ? ref.name.substring(0, ref.name.length - 1) : ref.name;
						if (options?.quoted) {
							refName = `'${refName}'`;
						}
						before = true;
					}

					if (options.label) {
						if (options.icon) {
							if (before) {
								result = options.capitalize
									? l10n.t('Before commit $(git-commit)\u00a0{0}{1}', refName, message ?? '')
									: l10n.t('before commit $(git-commit)\u00a0{0}{1}', refName, message ?? '');
							} else {
								result =
									options.capitalize && options.expand
										? l10n.t('Commit $(git-commit)\u00a0{0}{1}', refName, message ?? '')
										: l10n.t('commit $(git-commit)\u00a0{0}{1}', refName, message ?? '');
							}
						} else if (before) {
							result = options.capitalize
								? l10n.t('Before commit {0}{1}', refName, message ?? '')
								: l10n.t('before commit {0}{1}', refName, message ?? '');
						} else {
							result =
								options.capitalize && options.expand
									? l10n.t('Commit {0}{1}', refName, message ?? '')
									: l10n.t('commit {0}{1}', refName, message ?? '');
						}
					} else {
						result = options.icon
							? `$(git-commit)\u00a0${refName}${message ?? ''}`
							: `${refName}${message ?? ''}`;
					}
				}
				break;
			}
		}

		return result;
	}

	const expanded = options.expand ? ` (${refs.map(r => r.name).join(', ')})` : '';
	switch (refs[0].refType) {
		case 'branch':
			return l10n.t('{0} branches{1}', refs.length, expanded);
		case 'tag':
			return l10n.t('{0} tags{1}', refs.length, expanded);
		default:
			return isStashReference(refs[0])
				? l10n.t('{0} stashes{1}', refs.length, expanded)
				: l10n.t('{0} commits{1}', refs.length, expanded);
	}
}

export function getReferenceTypeIcon(ref: GitReference | undefined, webview?: boolean): string {
	switch (ref?.refType) {
		case 'branch':
			if (ref.remote) return 'cloud';
			if (ref.worktree) return webview ? 'gl-worktree' : 'gitlens-worktree';
			return 'git-branch';
		case 'tag':
			return 'tag';
		case 'stash':
			return 'archive';
		default:
			return 'git-commit';
	}
}
