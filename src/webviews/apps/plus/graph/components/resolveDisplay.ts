import { css, html } from 'lit';
import type { ConflictResolutionStrategy } from '../../../../plus/graph/graphService.js';

/**
 * Shared display vocabulary for AI conflict-resolution rows — used by the resolve mode panel and
 * the automatic rebase summary sheet so both surfaces render the same strategy badges and
 * confidence pips. Templates use `resolve-file__*` classes; include {@link resolveDisplayStyles}
 * in the consumer's `static styles`.
 */

/** Friendly label + icon for each conflict-tools resolution strategy. `skipped` is a warning —
 *  the file was intentionally left conflicted and still needs manual attention. Labels are sentence
 *  case to match the conflict-kind badges — one badge vocabulary. */
export const strategyDisplay: Record<ConflictResolutionStrategy, { label: string; icon: string; warn?: boolean }> = {
	ai: { label: 'Merged', icon: 'gl-merge' },
	'take-ours': { label: 'Kept current', icon: 'gl-accept-left' },
	'take-theirs': { label: 'Took incoming', icon: 'gl-accept-right' },
	deleted: { label: 'Deleted', icon: 'trash' },
	skipped: { label: 'Needs review', icon: 'warning', warn: true },
};

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

/** Styles backing {@link strategyDisplay} badges and {@link renderConfidence} pips. */
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
`;
