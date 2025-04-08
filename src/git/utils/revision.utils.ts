import type { GitRevisionRange, GitRevisionRangeNotation } from '../models/revision';
import { deletedOrMissing, uncommitted, uncommittedStaged } from '../models/revision';

const rangeRegex = /^([\w\-/]+(?:\.[\w\-/]+)*)?(\.\.\.?)([\w\-/]+(?:\.[\w\-/]+)*)?$/;
const qualifiedRangeRegex = /^([\w\-/]+(?:\.[\w\-/]+)*)(\.\.\.?)([\w\-/]+(?:\.[\w\-/]+)*)$/;
const qualifiedDoubleDotRange = /^([\w\-/]+(?:\.[\w\-/]+)*)(\.\.)([\w\-/]+(?:\.[\w\-/]+)*)$/;
const qualifiedTripleDotRange = /^([\w\-/]+(?:\.[\w\-/]+)*)(\.\.\.)([\w\-/]+(?:\.[\w\-/]+)*)$/;
const shaWithOptionalRevisionSuffixRegex = /(^[0-9a-f]{40}([\^@~:]\S*)?$)|(^[0]{40}(:|-)$)/;
const shaRegex = /(^[0-9a-f]{40}$)|(^[0]{40}(:|-)$)/;
const shaShortRegex = /(^[0-9a-f]{7,40}$)|(^[0]{40}(:|-)$)/;
const shaParentRegex = /(^[0-9a-f]{40})\^[0-3]?$/;
const shaShortenRegex = /^(.*?)([\^@~:].*)?$/;
const uncommittedRegex = /^[0]{40}(?:[\^@~:]\S*)?:?$/;
const uncommittedStagedRegex = /^[0]{40}([\^@~]\S*)?:$/;

function isMatch(regex: RegExp, rev: string | undefined) {
	return !rev ? false : regex.test(rev);
}

/** Checks if the rev looks like a SHA-1 hash
 * @param allowShort If true, allows short SHAs (7-40 characters)
 */
export function isSha(rev: string, allowShort: boolean = false): boolean {
	return isMatch(allowShort ? shaShortRegex : shaRegex, rev);
}

/** Checks if the rev looks like a SHA-1 hash with an optional revision navigation suffixes (like ^, @, ~, or :) */
export function isShaWithOptionalRevisionSuffix(rev: string): boolean {
	return isMatch(shaWithOptionalRevisionSuffixRegex, rev);
}

/** Checks if the rev looks like a SHA-1 hash with a ^ parent suffix */
export function isShaWithParentSuffix(rev: string): boolean {
	return isMatch(shaParentRegex, rev);
}

export function isUncommitted(rev: string | undefined, exact: boolean = false): boolean {
	return rev === uncommitted || rev === uncommittedStaged || (!exact && isMatch(uncommittedRegex, rev));
}

export function isUncommittedStaged(rev: string | undefined, exact: boolean = false): boolean {
	return rev === uncommittedStaged || (!exact && isMatch(uncommittedStagedRegex, rev));
}

export function isUncommittedWithParentSuffix(
	rev: string | undefined,
): rev is '0000000000000000000000000000000000000000^' | '0000000000000000000000000000000000000000:^' {
	return rev === `${uncommitted}^` || rev === `${uncommittedStaged}^`;
}

let abbreviatedShaLength = 7;
export function getAbbreviatedShaLength(): number {
	return abbreviatedShaLength;
}

export function setAbbreviatedShaLength(length: number): void {
	abbreviatedShaLength = length;
}

export function shortenRevision(
	rev: string | undefined,
	options?: {
		strings?: { uncommitted?: string; uncommittedStaged?: string; working?: string };
	},
): string {
	if (rev === deletedOrMissing) return '(deleted)';
	if (!rev) return options?.strings?.working ?? '';
	if (isUncommitted(rev)) {
		return isUncommittedStaged(rev)
			? options?.strings?.uncommittedStaged ?? 'Index'
			: options?.strings?.uncommitted ?? 'Working Tree';
	}
	if (isRevisionRange(rev) || !isShaWithOptionalRevisionSuffix(rev)) return rev;

	// Don't allow shas to be shortened to less than 5 characters
	const len = Math.max(5, getAbbreviatedShaLength());

	// If we have a suffix, append it
	const match = shaShortenRegex.exec(rev);
	if (match != null) {
		const [, rev, suffix] = match;

		if (suffix != null) {
			return `${rev.substring(0, len)}${suffix}`;
		}
	}

	return rev.substring(0, len);
}

export function createRevisionRange(
	left: string | undefined,
	right: string | undefined,
	notation: GitRevisionRangeNotation,
): GitRevisionRange {
	return `${left ?? ''}${notation}${right ?? ''}`;
}

export function getRevisionRangeParts(
	revRange: GitRevisionRange,
): { left: string | undefined; right: string | undefined; notation: GitRevisionRangeNotation } | undefined {
	const match = rangeRegex.exec(revRange);
	if (match == null) return undefined;

	const [, left, notation, right] = match;
	return {
		left: left || undefined,
		right: right || undefined,
		notation: notation as GitRevisionRangeNotation,
	};
}

export function isRevisionRange(
	rev: string | undefined,
	rangeType: 'any' | 'qualified' | 'qualified-double-dot' | 'qualified-triple-dot' = 'any',
): rev is GitRevisionRange {
	if (rev == null) return false;

	switch (rangeType) {
		case 'qualified':
			return qualifiedRangeRegex.test(rev);
		case 'qualified-double-dot':
			return qualifiedDoubleDotRange.test(rev);
		case 'qualified-triple-dot':
			return qualifiedTripleDotRange.test(rev);
		default:
			return rangeRegex.test(rev);
	}
}
