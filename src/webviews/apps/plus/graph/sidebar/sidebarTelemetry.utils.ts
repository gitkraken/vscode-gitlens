/**
 * Extracts a sidebar tag's name from the clicked tree-node path.
 *
 * The path encodes the tag differently per layout:
 * - list mode: `flat:<sha>:<name>` (see `buildItemTree`'s flat branch) — the name is everything
 *   after the second colon, so tag names containing `:` survive.
 * - tree mode: `makeHierarchical`'s `relativePath`, which is the tag name with a leading slash
 *   (the join fold seeds from `''`), e.g. `/v1.0` or `/release/1.0`.
 *
 * Returns undefined when there's no path to resolve from.
 */
export function getSidebarTagNameFromPath(path: string | undefined): string | undefined {
	if (path == null) return undefined;
	return path.startsWith('flat:') ? path.substring(path.indexOf(':', 5) + 1) : path.replace(/^\//, '');
}

/**
 * Resolves the selected tag from the clicked node's path, falling back to a sha match.
 *
 * Multiple tags can point at the same commit (`sha` is the peeled commit sha), so a sha match alone
 * can resolve to the wrong tag. The node path uniquely identifies the clicked tag, so prefer a
 * name match and only fall back to sha when the path doesn't resolve (e.g. an unexpected format).
 */
export function resolveSelectedTag<T extends { name: string; sha?: string }>(
	items: readonly T[],
	sha: string,
	path: string | undefined,
): T | undefined {
	const name = getSidebarTagNameFromPath(path);
	return items.find(t => t.name === name) ?? items.find(t => t.sha === sha);
}
