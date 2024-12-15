import type { GitRevisionRange } from './revision';
import { deletedOrMissing, uncommitted, uncommittedStaged } from './revision';

const rangeRegex = /^([\w\-/]+(?:\.[\w\-/]+)*)?(\.\.\.?)([\w\-/]+(?:\.[\w\-/]+)*)?$/;
const qualifiedRangeRegex = /^([\w\-/]+(?:\.[\w\-/]+)*)(\.\.\.?)([\w\-/]+(?:\.[\w\-/]+)*)$/;
const qualifiedDoubleDotRange = /^([\w\-/]+(?:\.[\w\-/]+)*)(\.\.)([\w\-/]+(?:\.[\w\-/]+)*)$/;
const qualifiedTripleDotRange = /^([\w\-/]+(?:\.[\w\-/]+)*)(\.\.\.)([\w\-/]+(?:\.[\w\-/]+)*)$/;
const shaLikeRegex = /(^[0-9a-f]{40}([\^@~:]\S*)?$)|(^[0]{40}(:|-)$)/;
const shaRegex = /(^[0-9a-f]{40}$)|(^[0]{40}(:|-)$)/;
const shaParentRegex = /(^[0-9a-f]{40})\^[0-3]?$/;
const shaShortenRegex = /^(.*?)([\^@~:].*)?$/;
const uncommittedRegex = /^[0]{40}(?:[\^@~:]\S*)?:?$/;
const uncommittedStagedRegex = /^[0]{40}([\^@~]\S*)?:$/;

function isMatch(regex: RegExp, ref: string | undefined) {
	return !ref ? false : regex.test(ref);
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

let abbreviatedShaLength = 7;
export function getAbbreviatedShaLength() {
	return abbreviatedShaLength;
}

export function setAbbreviatedShaLength(length: number) {
	abbreviatedShaLength = length;
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
	const len = Math.max(5, getAbbreviatedShaLength());

	// If we have a suffix, append it
	const match = shaShortenRegex.exec(ref);
	if (match != null) {
		const [, rev, suffix] = match;

		if (suffix != null) {
			return `${rev.substring(0, len)}${suffix}`;
		}
	}

	return ref.substring(0, len);
}

export function createRevisionRange(
	left: string | undefined,
	right: string | undefined,
	notation: '..' | '...',
): GitRevisionRange {
	return `${left ?? ''}${notation}${right ?? ''}`;
}

export function getRevisionRangeParts(
	ref: GitRevisionRange,
): { left: string | undefined; right: string | undefined; notation: '..' | '...' } | undefined {
	const match = rangeRegex.exec(ref);
	if (match == null) return undefined;

	const [, left, notation, right] = match;
	return {
		left: left || undefined,
		right: right || undefined,
		notation: notation as '..' | '...',
	};
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
