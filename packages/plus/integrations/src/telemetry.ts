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
