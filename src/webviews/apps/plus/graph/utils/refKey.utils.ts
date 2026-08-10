/**
 * Stable, UNIQUE per-ref key (a local branch and the remote it tracks share a `name`, e.g. `main` vs
 * `origin/main`, so name alone can't identify a ref). Kind + remote owner + name disambiguates:
 * `head:main`, `remote:origin/main`, `tag:v1`, `wip:<worktree path>`. Also what the rendered pill
 * carries as `data-ref-key`.
 *
 * The single derivation shared by the graph's pills and the ref finder — kept in `utils/` (rather
 * than `graph-commit.ts`) so both sides can import it without either depending on the other.
 */
export function refPillKey(ref: { kind: string; name: string; owner?: string | null }): string {
	return ref.kind === 'remote' ? `remote:${ref.owner ?? ''}/${ref.name}` : `${ref.kind}:${ref.name}`;
}

/**
 * The key a CONTEXT pin (native menu open over a pill) is stored and matched under — {@link refPillKey}
 * qualified by the row's jump sha when there is one.
 *
 * `refPillKey` alone can't tell two pills apart here: the WIP row's row-marker PROXY pill renders the
 * HEAD row's refs, so it carries the SAME `data-ref-key` as the real pill on the HEAD row. Right-clicking
 * the proxy would otherwise expand the HEAD row's pill — the one the user is not pointing at — and leave
 * the proxy to collapse the moment the menu stole its `:hover`.
 */
export function refContextPinKey(refKey: string | undefined, jumpSha: string | undefined): string | undefined {
	if (refKey == null) return undefined;

	return jumpSha != null ? `${jumpSha}|${refKey}` : refKey;
}
