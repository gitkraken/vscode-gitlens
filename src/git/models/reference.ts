import { GlyphChars } from '../../constants';
import { configuration } from '../../system/configuration';
import { capitalize } from '../../system/string';
import { getBranchNameWithoutRemote, getRemoteNameFromBranchName, getRemoteNameSlashIndex } from './branch';
import { deletedOrMissing, uncommitted, uncommittedStaged } from './constants';

const rangeRegex = /^(\S*?)(\.\.\.?)(\S*)\s*$/;
const shaLikeRegex = /(^[0-9a-f]{40}([\^@~:]\S*)?$)|(^[0]{40}(:|-)$)/;
const shaRegex = /(^[0-9a-f]{40}$)|(^[0]{40}(:|-)$)/;
const shaParentRegex = /(^[0-9a-f]{40})\^[0-3]?$/;
const shaShortenRegex = /^(.*?)([\^@~:].*)?$/;
const uncommittedRegex = /^[0]{40}(?:[\^@~:]\S*)?:?$/;
const uncommittedStagedRegex = /^[0]{40}([\^@~]\S*)?:$/;

function isMatch(regex: RegExp, ref: string | undefined) {
	return !ref ? false : regex.test(ref);
}

export function createRevisionRange(
	ref1: string | undefined,
	ref2: string | undefined,
	notation: '..' | '...' = '..',
): string {
	return `${ref1 ?? ''}${notation}${ref2 ?? ''}`;
}

export function isRevisionRange(ref: string | undefined) {
	return ref?.includes('..') ?? false;
}

export function isSha(ref: string) {
	return isMatch(shaRegex, ref);
}

export function isShaLike(ref: string) {
	return isMatch(shaLikeRegex, ref);
}

export function isShaParent(ref: string) {
	return isMatch(shaParentRegex, ref);
}

export function isUncommitted(ref: string | undefined, exact: boolean = false) {
	return ref === uncommitted || ref === uncommittedStaged || (!exact && isMatch(uncommittedRegex, ref));
}

export function isUncommittedParent(ref: string | undefined) {
	return ref === `${uncommitted}^` || ref === `${uncommittedStaged}^`;
}

export function isUncommittedStaged(ref: string | undefined, exact: boolean = false): boolean {
	return ref === uncommittedStaged || (!exact && isMatch(uncommittedStagedRegex, ref));
}

export function shortenRevision(
	ref: string | undefined,
	options?: {
		force?: boolean;
		strings?: { uncommitted?: string; uncommittedStaged?: string; working?: string };
	},
) {
	if (ref === deletedOrMissing) return '(deleted)';

	if (!ref) return options?.strings?.working ?? '';
	if (isUncommitted(ref)) {
		return isUncommittedStaged(ref)
			? options?.strings?.uncommittedStaged ?? 'Index'
			: options?.strings?.uncommitted ?? 'Working Tree';
	}

	if (isRevisionRange(ref)) return ref;
	if (!options?.force && !isShaLike(ref)) return ref;

	// Don't allow shas to be shortened to less than 5 characters
	const len = Math.max(5, configuration.get('advanced.abbreviatedShaLength'));

	// If we have a suffix, append it
	const match = shaShortenRegex.exec(ref);
	if (match != null) {
		const [, rev, suffix] = match;

		if (suffix != null) {
			return `${rev.substr(0, len)}${suffix}`;
		}
	}

	return ref.substr(0, len);
}

export function splitRevisionRange(ref: string): { ref1: string; ref2: string; notation: '..' | '...' } | undefined {
	const match = rangeRegex.exec(ref);
	if (match == null) return undefined;

	const [, ref1, notation, ref2] = match;
	return {
		ref1: ref1,
		notation: notation as '..' | '...',
		ref2: ref2,
	};
}

export interface GitBranchReference {
	readonly refType: 'branch';
	id?: string;
	name: string;
	ref: string;
	readonly remote: boolean;
	readonly upstream?: { name: string; missing: boolean };
	repoPath: string;
}

export interface GitRevisionReference {
	readonly refType: 'revision' | 'stash';
	id?: undefined;
	name: string;
	ref: string;
	repoPath: string;

	number?: string | undefined;
	message?: string | undefined;
}

export interface GitStashReference {
	readonly refType: 'stash';
	id?: undefined;
	name: string;
	ref: string;
	repoPath: string;
	number: string | undefined;

	message?: string | undefined;
	stashOnRef?: string | undefined;
}

export interface GitTagReference {
	readonly refType: 'tag';
	id?: string;
	name: string;
	ref: string;
	repoPath: string;
}

export type GitReference = GitBranchReference | GitRevisionReference | GitStashReference | GitTagReference;

export function createReference(
	ref: string,
	repoPath: string,
	options: {
		refType: 'branch';
		name: string;
		id?: string;
		remote: boolean;
		upstream?: { name: string; missing: boolean };
	},
): GitBranchReference;
export function createReference(
	ref: string,
	repoPath: string,
	options?: { refType: 'revision'; name?: string; message?: string },
): GitRevisionReference;
export function createReference(
	ref: string,
	repoPath: string,
	options: { refType: 'stash'; name: string; number: string | undefined; message?: string; stashOnRef?: string },
): GitStashReference;
export function createReference(
	ref: string,
	repoPath: string,
	options: { refType: 'tag'; name: string; id?: string },
): GitTagReference;
export function createReference(
	ref: string,
	repoPath: string,
	options:
		| {
				id?: string;
				refType: 'branch';
				name: string;
				remote: boolean;
				upstream?: { name: string; missing: boolean };
		  }
		| { refType?: 'revision'; name?: string; message?: string }
		| { refType: 'stash'; name: string; number: string | undefined; message?: string; stashOnRef?: string }
		| { id?: string; refType: 'tag'; name: string } = { refType: 'revision' },
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
				upstream: options.upstream,
			};
		case 'stash':
			return {
				refType: 'stash',
				repoPath: repoPath,
				ref: ref,
				name: options.name,
				number: options.number,
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
			};
		default:
			return {
				refType: 'revision',
				repoPath: repoPath,
				ref: ref,
				name: options.name ?? shortenRevision(ref, { force: true, strings: { working: 'Working Tree' } }),
				message: options.message,
			};
	}
}

export function getReferenceFromBranch(branch: GitBranchReference) {
	return createReference(branch.ref, branch.repoPath, {
		id: branch.id,
		refType: branch.refType,
		name: branch.name,
		remote: branch.remote,
		upstream: branch.upstream,
	});
}

export function getReferenceFromRevision(revision: GitRevisionReference) {
	if (revision.refType === 'stash') {
		return createReference(revision.ref, revision.repoPath, {
			refType: revision.refType,
			name: revision.name,
			number: revision.number,
			message: revision.message,
		});
	}

	return createReference(revision.ref, revision.repoPath, {
		refType: revision.refType,
		name: revision.name,
		message: revision.message,
	});
}

export function getReferenceFromTag(tag: GitTagReference) {
	return createReference(tag.ref, tag.repoPath, {
		id: tag.id,
		refType: tag.refType,
		name: tag.name,
	});
}

export function getNameWithoutRemote(ref: GitReference) {
	if (ref.refType === 'branch') {
		return ref.remote ? getBranchNameWithoutRemote(ref.name) : ref.name;
	}
	return ref.name;
}

export function getBranchTrackingWithoutRemote(ref: GitBranchReference) {
	return ref.upstream?.name.substring(getRemoteNameSlashIndex(ref.upstream.name) + 1);
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

export function isBranchReference(ref: GitReference | undefined): ref is GitBranchReference {
	return ref?.refType === 'branch';
}

export function isRevisionReference(ref: GitReference | undefined): ref is GitRevisionReference {
	return ref?.refType === 'revision';
}

export function isRevisionRangeReference(ref: GitReference | undefined): ref is GitRevisionReference {
	return ref?.refType === 'revision' && isRevisionRange(ref.ref);
}

export function isStashReference(ref: GitReference | undefined): ref is GitStashReference {
	return ref?.refType === 'stash' || (ref?.refType === 'revision' && Boolean((ref as any)?.stashName));
}

export function isTagReference(ref: GitReference | undefined): ref is GitTagReference {
	return ref?.refType === 'tag';
}

export function getReferenceLabel(
	refs: GitReference | GitReference[] | undefined,
	options?: { capitalize?: boolean; expand?: boolean; icon?: boolean; label?: boolean; quoted?: boolean } | false,
) {
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
			case 'branch':
				if (ref.remote) {
					refName = `${getRemoteNameFromBranchName(refName)}: ${getBranchNameWithoutRemote(refName)}`;
					refName = options?.quoted ? `'${refName}'` : refName;
				}

				result = `${options.label ? `${ref.remote ? 'remote ' : ''}branch ` : ''}${
					options.icon ? `$(git-branch)${GlyphChars.Space}${refName}` : refName
				}`;
				break;
			case 'tag':
				result = `${options.label ? 'tag ' : ''}${
					options.icon ? `$(tag)${GlyphChars.Space}${refName}` : refName
				}`;
				break;
			default: {
				if (isStashReference(ref)) {
					let message;
					if (options.expand && ref.message) {
						message = `${ref.number != null ? `#${ref.number}: ` : ''}${
							ref.message.length > 20
								? `${ref.message.substring(0, 20).trimRight()}${GlyphChars.Ellipsis}`
								: ref.message
						}`;
					}

					result = `${options.label ? 'stash ' : ''}${
						options.icon
							? `$(archive)${GlyphChars.Space}${message ?? ref.name}`
							: `${message ?? (ref.number ? `#${ref.number}` : ref.name)}`
					}`;
				} else if (isRevisionRange(ref.ref)) {
					result = refName;
				} else {
					let message;
					if (options.expand && ref.message) {
						message =
							ref.message.length > 20
								? ` (${ref.message.substring(0, 20).trimRight()}${GlyphChars.Ellipsis})`
								: ` (${ref.message})`;
					}

					let prefix;
					if (options.expand && options.label && isShaParent(ref.ref)) {
						refName = ref.name.endsWith('^') ? ref.name.substr(0, ref.name.length - 1) : ref.name;
						if (options?.quoted) {
							refName = `'${refName}'`;
						}
						prefix = 'before ';
					} else {
						prefix = '';
					}

					result = `${options.label ? `${prefix}commit ` : ''}${
						options.icon
							? `$(git-commit)${GlyphChars.Space}${refName}${message ?? ''}`
							: `${refName}${message ?? ''}`
					}`;
				}
				break;
			}
		}

		return options.capitalize && options.expand && options.label !== false ? capitalize(result) : result;
	}

	const expanded = options.expand ? ` (${refs.map(r => r.name).join(', ')})` : '';
	switch (refs[0].refType) {
		case 'branch':
			return `${refs.length} branches${expanded}`;
		case 'tag':
			return `${refs.length} tags${expanded}`;
		default:
			return `${refs.length} ${isStashReference(refs[0]) ? 'stashes' : 'commits'}${expanded}`;
	}
}
