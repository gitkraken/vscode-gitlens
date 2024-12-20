import { GlyphChars } from '../../../constants';
// import { getBranchNameWithoutRemote, getRemoteNameFromBranchName } from '../../../git/models/branch';
import type { GitReference, GitStashReference } from '../../../git/models/reference';
import type { GitRevisionRange } from '../../../git/models/revision';
// import { isRevisionRange, isShaParent, isStashReference } from '../../../git/models/reference';
import { capitalize } from '../../../system/string';

// import { getBranchNameWithoutRemote, getRemoteNameFromBranchName } from '../../../git/models/branch';
export function getRemoteNameSlashIndex(name: string): number {
	return name.startsWith('remotes/') ? name.indexOf('/', 8) : name.indexOf('/');
}
export function getBranchNameWithoutRemote(name: string): string {
	return name.substring(getRemoteNameSlashIndex(name) + 1);
}
export function getRemoteNameFromBranchName(name: string): string {
	return name.substring(0, getRemoteNameSlashIndex(name));
}

// import { isRevisionRange, isShaParent, isStashReference } from '../../../git/models/reference';
const rangeRegex = /^([\w\-/]+(?:\.[\w\-/]+)*)?(\.\.\.?)([\w\-/]+(?:\.[\w\-/]+)*)?$/;
const qualifiedRangeRegex = /^([\w\-/]+(?:\.[\w\-/]+)*)(\.\.\.?)([\w\-/]+(?:\.[\w\-/]+)*)$/;
const qualifiedDoubleDotRange = /^([\w\-/]+(?:\.[\w\-/]+)*)(\.\.)([\w\-/]+(?:\.[\w\-/]+)*)$/;
const qualifiedTripleDotRange = /^([\w\-/]+(?:\.[\w\-/]+)*)(\.\.\.)([\w\-/]+(?:\.[\w\-/]+)*)$/;
const shaParentRegex = /(^[0-9a-f]{40})\^[0-3]?$/;

function isMatch(regex: RegExp, ref: string | undefined) {
	return !ref ? false : regex.test(ref);
}

export function isRevisionRange(
	ref: string | undefined,
	rangeType: 'any' | 'qualified' | 'qualified-double-dot' | 'qualified-triple-dot' = 'any',
): ref is GitRevisionRange {
	if (ref == null) return false;

	switch (rangeType) {
		case 'qualified':
			return qualifiedRangeRegex.test(ref);
		case 'qualified-double-dot':
			return qualifiedDoubleDotRange.test(ref);
		case 'qualified-triple-dot':
			return qualifiedTripleDotRange.test(ref);
		default:
			return rangeRegex.test(ref);
	}
}

export function isShaParent(ref: string) {
	return isMatch(shaParentRegex, ref);
}

export function isStashReference(ref: GitReference | undefined): ref is GitStashReference {
	return ref?.refType === 'stash' || (ref?.refType === 'revision' && Boolean((ref as any)?.stashName));
}

export function getReferenceLabel(
	refs: GitReference | undefined,
	options?: { capitalize?: boolean; expand?: boolean; icon?: boolean; label?: boolean; quoted?: boolean } | false,
) {
	if (refs == null) return '';

	options =
		options === false
			? {}
			: { expand: true, icon: true, label: options?.label ?? options?.expand ?? true, ...options };

	let result;
	const ref = refs;
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
			result = `${options.label ? 'tag ' : ''}${options.icon ? `$(tag)${GlyphChars.Space}${refName}` : refName}`;
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
