/**
 * Stable, UNIQUE per-ref key (a local branch and the remote it tracks share a `name`, e.g. `main` vs
 * `origin/main`, so name alone can't identify a ref). Kind + remote owner + name disambiguates:
 * `head:main`, `remote:origin/main`, `tag:v1`. Also what the rendered pill carries as `data-ref-key`.
 *
 * The single derivation shared by the graph's pills and the ref finder — kept in `utils/` (rather
 * than `graph-commit.ts`) so both sides can import it without either depending on the other.
 */
export function refPillKey(ref: { kind: string; name: string; owner?: string | null }): string {
	return ref.kind === 'remote' ? `remote:${ref.owner ?? ''}/${ref.name}` : `${ref.kind}:${ref.name}`;
}
