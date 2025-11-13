import type { GitCommitSearchContext } from '../search';

export function areSearchContextsEqual(
	a: GitCommitSearchContext | undefined,
	b: GitCommitSearchContext | undefined,
	deep: boolean,
): boolean {
	if (a === b) return true;
	if (a == null || b == null) return false;

	return (
		a.query === b.query &&
		(!deep ||
			(a.queryFilters.files === b.queryFilters.files &&
				a.queryFilters.refs === b.queryFilters.refs &&
				a.queryFilters.type === b.queryFilters.type &&
				a.matchedFiles.length === b.matchedFiles.length &&
				a.matchedFiles.every((f, i) => f.path === b.matchedFiles[i].path)))
	);
}
