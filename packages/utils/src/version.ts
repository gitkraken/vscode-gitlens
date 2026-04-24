import { compareIgnoreCase } from './string.js';

declare type VersionComparisonResult = -1 | 0 | 1;

export interface Version {
	major: number;
	minor: number;
	patch: number;
	pre?: string;
}

export function compare(v1: string | Version, v2: string | Version): VersionComparisonResult {
	if (typeof v1 === 'string') {
		v1 = fromString(v1);
	}
	if (typeof v2 === 'string') {
		v2 = fromString(v2);
	}

	if (v1.major > v2.major) return 1;
	if (v1.major < v2.major) return -1;

	if (v1.minor > v2.minor) return 1;
	if (v1.minor < v2.minor) return -1;

	if (v1.patch > v2.patch) return 1;
	if (v1.patch < v2.patch) return -1;

	if (v1.pre === undefined && v2.pre !== undefined) return 1;
	if (v1.pre !== undefined && v2.pre === undefined) return -1;

	if (v1.pre !== undefined && v2.pre !== undefined) return compareIgnoreCase(v1.pre, v2.pre);

	return 0;
}

export function from(major: string | number, minor: string | number, patch?: string | number, pre?: string): Version {
	return {
		major: typeof major === 'string' ? parseInt(major, 10) : major,
		minor: typeof minor === 'string' ? parseInt(minor, 10) : minor,
		patch: patch == null ? 0 : typeof patch === 'string' ? parseInt(patch, 10) : patch,
		pre: pre,
	};
}

export function fromString(version: string): Version {
	const [ver, pre] = version.split('-');
	const [major, minor, patch] = ver.split('.');
	return from(major, minor, patch, pre);
}

export function fromVersion(v: Version, includePre: false): `${number}.${number}.${number}`;
export function fromVersion(v: Version, includePre?: boolean): `${number}.${number}.${number}${string | undefined}`;
export function fromVersion(v: Version, includePre?: boolean): `${number}.${number}.${number}${string | undefined}` {
	return `${v.major}.${v.minor}.${v.patch}${includePre && v.pre ? `-${v.pre}` : ''}`;
}

/**
 * Compares two strings using version-aware sorting in descending order,
 * matching git's `--sort=-version:refname` (based on glibc's `strverscmp`).
 *
 * Walks character-by-character: non-digit runs are compared lexicographically,
 * digit runs are compared numerically. No prefix stripping (git only strips
 * prefixes when `versionsort.prefix` is configured).
 */
export function compareByVersionDescending(a: string, b: string): number {
	return -compareByVersion(a, b);
}

/**
 * Compares two strings using version-aware sorting in ascending order,
 * matching git's `--sort=version:refname` (based on glibc's `strverscmp`).
 */
export function compareByVersion(a: string, b: string): number {
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		const ca = a.charCodeAt(i);
		const cb = b.charCodeAt(j);
		const aIsDigit = ca >= 48 && ca <= 57; // '0'-'9'
		const bIsDigit = cb >= 48 && cb <= 57;

		if (aIsDigit && bIsDigit) {
			// Both in a digit run — compare numerically
			let numA = 0;
			while (i < a.length && a.charCodeAt(i) >= 48 && a.charCodeAt(i) <= 57) {
				numA = numA * 10 + (a.charCodeAt(i) - 48);
				i++;
			}
			let numB = 0;
			while (j < b.length && b.charCodeAt(j) >= 48 && b.charCodeAt(j) <= 57) {
				numB = numB * 10 + (b.charCodeAt(j) - 48);
				j++;
			}
			if (numA !== numB) return numA - numB;
		} else {
			// Compare non-digit characters lexicographically
			if (ca !== cb) return ca - cb;
			i++;
			j++;
		}
	}
	return a.length - b.length;
}

export function satisfies(
	v: string | Version | null | undefined,
	requirement: `${'=' | '>' | '>=' | '<' | '<='} ${string}`,
): boolean {
	if (v == null) return false;

	const [op, version] = requirement.split(' ');

	if (op === '=') {
		return compare(v, version) === 0;
	} else if (op === '>') {
		return compare(v, version) > 0;
	} else if (op === '>=') {
		return compare(v, version) >= 0;
	} else if (op === '<') {
		return compare(v, version) < 0;
	} else if (op === '<=') {
		return compare(v, version) <= 0;
	}

	throw new Error(`Unknown operator: ${op}`);
}
