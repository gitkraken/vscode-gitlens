import { GlyphChars } from '../../constants';
import { capitalize } from '../../system/string';
import type { GitBranch } from './branch';
import { getBranchNameWithoutRemote, getRemoteNameFromBranchName } from './branch.utils';
import type { GitCommit, GitStashCommit } from './commit';
import type {
	GitBranchReference,
	GitReference,
	GitRevisionReference,
	GitStashReference,
	GitTagReference,
} from './reference';
import { isRevisionRange, isShaParent, shortenRevision } from './revision.utils';
import type { GitTag } from './tag';

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
				sha: ref,
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
				sha: ref,
				name: options.name ?? shortenRevision(ref, { force: true, strings: { working: 'Working Tree' } }),
				message: options.message,
			};
	}
}

export function getReferenceFromBranch(branch: GitBranch) {
	return createReference(branch.ref, branch.repoPath, {
		id: branch.id,
		refType: branch.refType,
		name: branch.name,
		remote: branch.remote,
		upstream: branch.upstream,
	});
}

export function getReferenceFromRevision(
	revision: GitCommit | GitStashCommit | GitRevisionReference,
	options?: { excludeMessage?: boolean },
) {
	if (revision.refType === 'stash') {
		return createReference(revision.ref, revision.repoPath, {
			refType: revision.refType,
			name: revision.name,
			number: revision.number,
			message: options?.excludeMessage ? undefined : revision.message,
		});
	}

	return createReference(revision.ref, revision.repoPath, {
		refType: revision.refType,
		name: revision.name,
		message: options?.excludeMessage ? undefined : revision.message,
	});
}

export function getReferenceFromTag(tag: GitTag) {
	return createReference(tag.ref, tag.repoPath, {
		id: tag.id,
		refType: tag.refType,
		name: tag.name,
	});
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
			case 'branch': {
				if (ref.remote) {
					refName = `${getRemoteNameFromBranchName(refName)}: ${getBranchNameWithoutRemote(refName)}`;
					refName = options?.quoted ? `'${refName}'` : refName;
				}

				let label;
				if (options.label) {
					if (options.capitalize && options.expand) {
						label = `${ref.remote ? 'Remote ' : ''}Branch `;
					} else {
						label = `${ref.remote ? 'remote ' : ''}branch `;
					}
				} else {
					label = '';
				}

				result = `${label}${options.icon ? `$(git-branch)${GlyphChars.Space}${refName}` : refName}`;
				break;
			}
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
								? `${ref.message.substring(0, 20).trimEnd()}${GlyphChars.Ellipsis}`
								: ref.message
						}`;
					}

					result = `${options.label ? 'stash ' : ''}${
						options.icon
							? `$(archive)${GlyphChars.Space}${message ?? ref.name}`
							: message ?? (ref.number ? `#${ref.number}` : ref.name)
					}`;
				} else if (isRevisionRange(ref.ref)) {
					result = refName;
				} else {
					let message;
					if (options.expand && ref.message) {
						message =
							ref.message.length > 20
								? ` (${ref.message.substring(0, 20).trimEnd()}${GlyphChars.Ellipsis})`
								: ` (${ref.message})`;
					}

					let prefix;
					if (options.expand && options.label && isShaParent(ref.ref)) {
						refName = ref.name.endsWith('^') ? ref.name.substring(0, ref.name.length - 1) : ref.name;
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

export function getReferenceTypeLabel(ref: GitReference | undefined) {
	switch (ref?.refType) {
		case 'branch':
			return 'Branch';
		case 'tag':
			return 'Tag';
		default:
			return 'Commit';
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
	return ref?.refType === 'stash' || (ref?.refType === 'revision' && Boolean((ref as any)?.stashName));
}

export function isTagReference(ref: GitReference | undefined): ref is GitTagReference {
	return ref?.refType === 'tag';
}
