/**
 * The record of what AI consulted while resolving a conflict.
 *
 * The resolver reports each repository consultation as a `resolver:tool-call` progress event, but a
 * progress line is transient — a step's files resolve concurrently onto one message, so it's
 * overwritten long before anyone reads it. Accumulating the calls per file is what lets the
 * resolution's own row say which evidence produced it, on both the Resolve panel and the automatic
 * rebase summary.
 *
 * No runtime dependencies, so the webview protocol can type-import {@link ConsultedTool} without
 * pulling the conflict-tools integration's Node deps into a bundle.
 */

/** One repository consultation: the tool AI called and the one-sentence justification it gave.
 *  `reason` is a required argument on every tool the resolver offers, so it's normally present —
 *  optional here because it's the model that fills it in. */
export interface ConsultedTool {
	tool: string;
	reason?: string;
}

/**
 * Max consultations retained per file. A resolution can spend up to `maxSteps` rounds calling tools,
 * with several calls per round. This list is evidence a human skims on one row, not an audit log, so
 * keep the earliest few — the calls that shaped the decision — and drop the tail. Tool *counts* stay
 * exact regardless (`ResolutionMetrics.toolCallCount`), so nothing is being under-reported.
 */
const maxConsultationsPerFile = 8;

/**
 * Records a `resolver:tool-call` against the file it was made for.
 *
 * Identical tool+reason pairs collapse: re-reading a file at a second ref repeats the same
 * justification, and a duplicated line reads as a glitch rather than as thoroughness.
 */
export function recordConsultation(
	consultations: Map<string, ConsultedTool[]>,
	event: { filePath: string; tool: string; reason?: string },
): void {
	let consulted = consultations.get(event.filePath);
	if (consulted == null) {
		consulted = [];
		consultations.set(event.filePath, consulted);
	}
	if (consulted.length >= maxConsultationsPerFile) return;

	const reason = event.reason?.trim() || undefined;
	if (consulted.some(c => c.tool === event.tool && c.reason === reason)) return;

	consulted.push({ tool: event.tool, ...(reason != null ? { reason: reason } : undefined) });
}

/** Reads a file's consultations back, as `undefined` when it made none — so "AI didn't need to
 *  consult" renders as nothing at all rather than as an empty list. */
export function getConsultations(
	consultations: Map<string, ConsultedTool[]>,
	filePath: string,
): ConsultedTool[] | undefined {
	const consulted = consultations.get(filePath);
	return consulted?.length ? consulted : undefined;
}
