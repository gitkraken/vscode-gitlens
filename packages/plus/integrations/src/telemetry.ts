/**
 * Telemetry-source types used by the integrations package.
 *
 * Mirrors the shape of the host's `Source` / `Sources` types from
 * `src/constants.telemetry.ts` but intentionally widens `source` to a plain
 * `string` so the package doesn't depend on the host's enumerated union.
 * The host passes its typed `Source` directly — TypeScript's structural
 * subtyping accepts the narrower type here.
 */
export type Source = {
	source: string;
	correlationId?: string;

	detail?: unknown;
};

export type Sources = string;

/**
 * Maps a telemetry `source`/`detail` to the `&context=` value the package appends when building
 * cloud-connect URLs. Owned here in the package (the host no longer carries a duplicate copy).
 */
export const sourceToContext: { [source: string]: string | undefined } = {
	launchpad: 'launchpad',
};

export const detailToContext: { [detail: string]: string | undefined } = {
	mcp: 'mcp',
};
