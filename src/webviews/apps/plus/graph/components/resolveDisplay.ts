import { css, html, nothing } from 'lit';
import { fnv1aHash } from '@gitlens/utils/hash.js';
import type { ConflictResolutionStrategy } from '../../../../plus/graph/graphService.js';

/**
 * Shared display vocabulary for AI conflict-resolution rows — used by the resolve mode panel and
 * the automatic rebase summary sheet so both surfaces render the same strategy badges and
 * confidence pips. Templates use `resolve-file__*` classes; include {@link resolveDisplayStyles}
 * in the consumer's `static styles`.
 */

export type ResolutionDisplay = { label: string; icon: string; warn?: boolean };

/** Friendly label + icon for each conflict-tools resolution strategy. `skipped` is a warning —
 *  the file was intentionally left conflicted and still needs manual attention. Labels are sentence
 *  case to match the conflict-kind badges — one badge vocabulary. */
export const strategyDisplay: Record<ConflictResolutionStrategy, ResolutionDisplay> = {
	ai: { label: 'Merged', icon: 'gl-merge' },
	'take-ours': { label: 'Kept current', icon: 'gl-accept-left' },
	'take-theirs': { label: 'Took incoming', icon: 'gl-accept-right' },
	deleted: { label: 'Deleted', icon: 'trash' },
	skipped: { label: 'Needs review', icon: 'warning', warn: true },
};

/** Presentation for a file the user resolved by hand after automation escalated. The record keeps
 *  the AI's last attempted strategy (`skipped` when it never got one), so {@link strategyDisplay}
 *  would badge a finished file "Needs review" — the opposite of what happened. Not a warning:
 *  nothing is outstanding. */
export const manualResolutionDisplay: ResolutionDisplay = { label: 'Resolved manually', icon: 'person' };

/** AI confidence bucket for a resolution (`confidence` is 0–1). Drives the confidence pips and the
 *  low-confidence emphasis (reasoning auto-expands, badge tints to warning). */
export function confidenceLevel(confidence: number): 'high' | 'medium' | 'low' {
	if (confidence >= 0.8) return 'high';
	if (confidence >= 0.5) return 'medium';
	return 'low';
}

/** Confidence pips (three dots, filled by level) + a text label. Neutral except low — the only
 *  actionable level — which tints to warning. */
export function renderConfidence(level: 'high' | 'medium' | 'low'): unknown {
	const filled = level === 'high' ? 3 : level === 'medium' ? 2 : 1;
	return html`<span class="resolve-file__conf resolve-file__conf--${level}" title="AI confidence: ${level}">
		<span class="resolve-file__pips" aria-hidden="true"
			>${[0, 1, 2].map(i => html`<i class="resolve-file__pip ${i < filled ? 'on' : ''}"></i>`)}</span
		><span class="resolve-file__conf-label">${level}</span>
	</span>`;
}

/** Marks the reasoning blocks {@link measureReasoningOverflow} measures — kept in sync by hand with the
 *  literal `data-reasoning` attribute in {@link renderReasoning} (Lit attribute names can't be dynamic). */
const reasoningAttr = 'data-reasoning';

/**
 * The AI's reasoning for a resolution, always visible but clamped to a few lines with a "see more"
 * expander — it's the text the user is being asked to audit, so it shouldn't cost a click to read.
 *
 * `overflowing` comes from {@link measureReasoningOverflow} so the expander only appears when there's
 * actually hidden text; an `expanded` block always shows its collapse affordance.
 */
export function renderReasoning(
	key: string,
	reasoning: string,
	options: { expanded: boolean; overflowing: boolean; filePath: string; onToggle: () => void },
): unknown {
	if (!reasoning) return nothing;

	const { expanded, overflowing, filePath, onToggle } = options;
	// Paths can carry characters that aren't valid in an IDREF (spaces most of all), and collapsing them
	// isn't reversible — `src/foo-bar.ts` and `src/foo/bar.ts` would land on the same id and cross-wire
	// both rows' `aria-controls`. The hash keeps it unique; the readable prefix keeps it inspectable.
	const id = `reasoning-${key.replace(/[^\w-]+/g, '-')}-${(fnv1aHash(key) >>> 0).toString(36)}`;
	// Kept in a variable so the <p> below stays on one line: the expanded state is `pre-wrap`, so any
	// newline/indent the formatter would introduce around the interpolation renders as literal blank space.
	const cls = expanded ? 'resolve-file__reasoning' : 'resolve-file__reasoning resolve-file__reasoning--clamped';

	return html`<div class="resolve-file__reason">
		<p id=${id} class=${cls} data-reasoning=${key}>${reasoning}</p>
		${
			expanded || overflowing
				? html`<button
						class="resolve-file__more"
						aria-controls=${id}
						aria-expanded=${expanded}
						aria-label="${expanded ? 'Hide' : 'Show'} the full reasoning for ${filePath}"
						@click=${onToggle}
					>
						${expanded ? 'see less' : 'see more'}
					</button>`
				: nothing
		}
	</div>`;
}

/** Friendlier names for the resolver's six read-only tools — the wire names are the model's API, not
 *  something to show a user reading why their conflict resolved the way it did. */
const consultedToolLabels: Record<string, string> = {
	show_file_at_ref: 'read the file',
	grep: 'searched the repository',
	blame: 'checked authorship',
	diff: 'compared the two sides',
	log: 'reviewed history',
	show: 'inspected a commit',
};

/**
 * What AI consulted before deciding, rendered under its reasoning so the row cites its evidence and
 * not just its verdict — the difference between "took incoming" and "took incoming, having checked
 * that the symbol it drops isn't referenced anywhere else".
 *
 * Collapsed by default: the evidence matters when someone is auditing a specific resolution, but
 * expanded on every row it buries the reasoning it exists to support — and a step with several files
 * would open as a wall of tool calls. The summary still carries the count, so a row that consulted
 * the repository is distinguishable from one that didn't without opening anything.
 *
 * Each entry leads with the model's own one-sentence justification (the `reason` argument every tool
 * requires), since the tool label alone is too vague to audit. Renders nothing when AI resolved from
 * the conflict's own context — the common case, and silence is the right signal for it.
 *
 * A native `<details>` keeps this helper stateless — both surfaces render it inside a `map`, so
 * per-row open state would otherwise have to be threaded through each of them — and brings the
 * keyboard and screen-reader behavior of a disclosure for free.
 */
export function renderConsulted(
	consulted: readonly { tool: string; reason?: string }[] | undefined,
	filePath: string,
): unknown {
	if (!consulted?.length) return nothing;

	const label = `Consulted ${consulted.length} source${consulted.length === 1 ? '' : 's'}`;

	return html`<details class="resolve-file__consulted">
		<!-- The accessible name has to START with the visible text (WCAG 2.5.3) — the file only
		     disambiguates the rows, so it's a suffix, not a replacement. -->
		<summary class="resolve-file__consulted-summary" aria-label="${label} for ${filePath}">
			<code-icon icon="chevron-right" size="12"></code-icon>
			<span class="resolve-file__consulted-text">${label}</span>
		</summary>
		<ul class="resolve-file__consulted-list">
			${consulted.map(c => {
				const toolLabel = consultedToolLabels[c.tool] ?? c.tool;
				return html`<li>
					${
						c.reason
							? html`${c.reason} <span class="resolve-file__consulted-tool">(${toolLabel})</span>`
							: toolLabel
					}
				</li>`;
			})}
		</ul>
	</details>`;
}

/**
 * Records which reasoning blocks are actually taller than their clamp, so {@link renderReasoning} only
 * offers "see more" where text is hidden. Returns `undefined` when nothing changed, so callers can skip
 * a re-render. Call from `updated()`.
 *
 * Expanded blocks aren't clamped and so can't be measured — their entry is left untouched, which keeps
 * the collapse affordance on a row that was expanded before it was ever measured (the low-confidence
 * auto-expand seed does exactly that).
 */
export function measureReasoningOverflow(root: ParentNode, current: ReadonlySet<string>): Set<string> | undefined {
	let next: Set<string> | undefined;

	for (const el of root.querySelectorAll<HTMLElement>(`[${reasoningAttr}]`)) {
		if (!el.classList.contains('resolve-file__reasoning--clamped')) continue;

		const key = el.getAttribute(reasoningAttr);
		if (key == null) continue;

		// A hair of slack so subpixel line-height rounding doesn't read as overflow
		const overflowing = el.scrollHeight > el.clientHeight + 1;
		if (overflowing === current.has(key)) continue;

		next ??= new Set(current);
		if (overflowing) {
			next.add(key);
		} else {
			next.delete(key);
		}
	}

	return next;
}

/** Styles backing {@link strategyDisplay} badges, {@link renderConfidence} pips, and
 *  {@link renderReasoning} blocks. */
export const resolveDisplayStyles = css`
	/* Small-caps matches GitLens' shared <gl-badge> convention (badges.css.ts) so the resolution
	   and conflict-kind badges read as house-style status tags rather than sentence fragments. */
	.resolve-file__badge {
		display: inline-flex;
		flex: none;
		gap: 0.3rem;
		align-items: center;
		padding: 0.25rem 0.5rem;
		font-size: var(--gl-font-sm);
		font-weight: 600;
		font-variant: all-small-caps;
		line-height: 1;
		letter-spacing: 0.02em;
		color: var(--vscode-badge-foreground);
		background: var(--vscode-badge-background);
		border-radius: var(--gl-radius-sm);
	}

	/* all-small-caps glyphs sit low in the line box next to the centred icon — raise them a hair. */
	.resolve-file__badge-text {
		transform: translateY(-0.05em);
	}

	.resolve-file__badge code-icon {
		transform: translateY(0.05em);
	}

	.resolve-file__badge--warn {
		color: var(--vscode-inputValidation-warningForeground, var(--vscode-badge-foreground));
		background: var(--vscode-inputValidation-warningBackground, var(--vscode-badge-background));
	}

	/* AI confidence pips — neutral; low tints to warning (the only actionable level). */
	.resolve-file__conf {
		display: inline-flex;
		flex: none;
		gap: 0.4rem;
		align-items: center;
		color: var(--vscode-descriptionForeground);
		font-size: var(--gl-font-sm);
	}

	.resolve-file__pips {
		display: inline-flex;
		gap: 0.2rem;
	}

	.resolve-file__pip {
		width: 0.5rem;
		height: 0.5rem;
		background: currentColor;
		border-radius: 50%;
		opacity: 0.3;
	}

	.resolve-file__pip.on {
		opacity: 1;
	}

	.resolve-file__conf--low {
		color: var(--vscode-inputValidation-warningForeground, var(--vscode-descriptionForeground));
	}

	/* AI reasoning block + its "see more" expander. The clamp is deliberately its own class rather than
	   part of .resolve-file__reasoning — consumers reuse that class for skipped-file, error, and
	   rename/rename messages, none of which may truncate. Doubled selector so it beats the consumers'
	   own single-class .resolve-file__reasoning rules, which are defined after these shared styles. */
	.resolve-file__reason {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.resolve-file__reasoning.resolve-file__reasoning--clamped {
		display: -webkit-box;
		overflow: hidden;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow-wrap: anywhere;
		/* -webkit-box can't honour pre-wrap; collapsing it also fits more of the text in the preview.
		   The expanded state falls back to the consumer's pre-wrap and keeps the model's formatting. */
		white-space: normal;
	}

	.resolve-file__more {
		align-self: flex-start;
		padding: var(--gl-space-2) 0;
		color: var(--vscode-textLink-foreground);
		font: inherit;
		font-size: var(--gl-font-sm);
		background: transparent;
		border: none;
		cursor: pointer;
	}

	.resolve-file__more:hover {
		text-decoration: underline;
	}

	/* The evidence behind the reasoning — secondary to it, so it's dimmed and a size down. Collapsed by
	   default; once open the list is never clamped, since a truncated citation is worse than none. */
	.resolve-file__consulted {
		min-width: 0;
		margin-top: var(--gl-space-6);
		color: var(--vscode-descriptionForeground);
		font-size: var(--gl-font-sm);
	}

	/* Styled as the sibling affordance of the reasoning's "see more", which sits directly above it.
	   The list-style and the webkit marker rule both matter: no single one of them hides the default
	   disclosure triangle across the engines this ships on. */
	.resolve-file__consulted-summary {
		display: inline-flex;
		gap: 0.3rem;
		align-items: center;
		width: fit-content;
		color: var(--vscode-textLink-foreground);
		cursor: pointer;
		list-style: none;
	}

	.resolve-file__consulted-summary::-webkit-details-marker {
		display: none;
	}

	/* Underline the text only, never the summary box. On the box the flex gap splits the rule in two, and
	   the chevron's 90deg rotation takes its segment with it — a stray vertical tick to the left. */
	.resolve-file__consulted-summary:hover .resolve-file__consulted-text {
		text-decoration: underline;
	}

	.resolve-file__consulted-summary:focus-visible {
		outline: var(--gl-border-width) solid var(--vscode-focusBorder);
		outline-offset: 2px;
	}

	.resolve-file__consulted[open] > .resolve-file__consulted-summary code-icon {
		transform: rotate(90deg);
	}

	.resolve-file__consulted-summary code-icon {
		transition: transform var(--gl-duration-medium);
	}

	@media (prefers-reduced-motion: reduce) {
		.resolve-file__consulted-summary code-icon {
			transition: none;
		}
	}

	.resolve-file__consulted-list {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-2);
		margin: var(--gl-space-4) 0 0;
		/* Room for the marker, which sits outside the content box in a flex-column list */
		padding-left: var(--gl-space-16);
		list-style: disc;
	}

	.resolve-file__consulted-list li {
		overflow-wrap: anywhere;
	}

	/* The tool name is the least interesting part of the line — the model's reason leads. */
	.resolve-file__consulted-tool {
		opacity: 0.75;
	}
`;
