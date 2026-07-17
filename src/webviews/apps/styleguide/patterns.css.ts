import { css } from 'lit';
import { elevatedSurface } from '../shared/components/styles/lit/elevation.css.js';

// Styles for the Patterns tab — hand-composed UI built from raw markup + --gl-* tokens only.
// No shared components are consumed here on purpose: this is the composition test for the token
// system itself, so every color/space/radius/shadow/duration reference below must be a --gl-*
// custom property (or the --vscode-editor-font-family monospace fallback the rest of the
// styleguide already uses).
export const patternsStyles = css`
	.patterns__grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(36rem, 1fr));
		gap: var(--gl-space-16);
		align-items: start;
	}

	.pattern {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-8);
	}

	.pattern--wide {
		grid-column: 1 / -1;
	}

	.pattern__title {
		margin: 0;
		font-size: var(--gl-font-md);
		font-weight: 600;
	}

	.pattern__tokens {
		margin: 0;
		font-family: var(--vscode-editor-font-family, monospace);
		font-size: var(--gl-font-sm);
		color: var(--gl-color-fg-faint);
	}

	/* ── Shared helpers (button / chip / link) ───────────────────────────── */

	.pattern-btn {
		padding: var(--gl-space-4) var(--gl-space-12);
		font-family: inherit;
		font-size: var(--gl-font-md);
		cursor: pointer;
		background: none;
		/* HC themes define no button fill — the contrast border is what makes it read as a button
		   there; border-contrast is guaranteed-invalid outside HC so the transparent fallback wins */
		border: var(--gl-border-width) solid var(--gl-color-border-contrast, transparent);
		border-radius: var(--gl-radius-sm);
	}

	.pattern-btn:focus-visible {
		outline: var(--gl-border-width) solid var(--gl-color-border-focus);
		outline-offset: 2px;
	}

	.pattern-btn--primary {
		color: var(--gl-color-accent-fg);
		background: var(--gl-color-accent);
	}

	.pattern-btn--primary:hover {
		background: var(--gl-color-accent-active);
	}

	.pattern-btn--secondary {
		color: var(--gl-color-fg);
		background: var(--gl-color-accent-secondary);
	}

	.pattern-btn--danger {
		color: var(--gl-color-on-status);
		background: var(--gl-color-danger);
	}

	.pattern-chip {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		padding: 0 var(--gl-space-8);
		font-size: var(--gl-font-sm);
		/* Same HC treatment as .pattern-btn — tinted fills vanish on the HC black/white surface */
		border: var(--gl-border-width) solid var(--gl-color-border-contrast, transparent);
		border-radius: var(--gl-radius-circle);
	}

	.pattern-chip--danger {
		color: var(--gl-color-danger);
		background: var(--gl-color-danger-bg);
	}

	.pattern-chip--warning {
		color: var(--gl-color-warning);
		background: var(--gl-color-warning-bg);
	}

	.pattern-chip--success {
		color: var(--gl-color-success);
		background: var(--gl-color-success-bg);
	}

	.pattern-chip--neutral {
		color: var(--gl-color-fg-muted);
		background: var(--gl-color-neutral-bg);
	}

	.pattern-input {
		padding: var(--gl-space-4) var(--gl-space-8);
		font-family: inherit;
		font-size: var(--gl-font-md);
		color: var(--gl-color-fg);
		background: var(--gl-color-surface-sunken);
		border: var(--gl-border-width) solid var(--gl-color-border);
		border-radius: var(--gl-radius-sm);
	}

	.pattern-input:focus-visible {
		outline: var(--gl-border-width) solid var(--gl-color-border-focus);
		outline-offset: -1px;
	}

	.pattern-input--invalid {
		border-color: var(--gl-color-danger);
	}

	.pattern-link {
		color: var(--gl-color-link);
		text-decoration: none;
	}

	.pattern-link:hover {
		color: var(--gl-color-link-active);
		text-decoration: underline;
	}

	.pattern-link:focus-visible {
		outline: var(--gl-border-width) solid var(--gl-color-border-focus);
		outline-offset: 2px;
	}

	.pattern-link--sm {
		font-size: var(--gl-font-sm);
	}

	/* ── Commit card ──────────────────────────────────────────────────────── */

	.commit-card {
		--gl-elevation: var(--gl-shadow-raised);
		--gl-elevation-border-color: var(--gl-color-border);

		display: flex;
		flex-direction: column;
		gap: var(--gl-space-8);
		padding: var(--gl-space-12) var(--gl-space-16);
		background: var(--gl-color-surface-raised);
		border-radius: var(--gl-radius-md);
		${elevatedSurface}
	}

	.commit-card__header {
		display: flex;
		gap: var(--gl-space-8);
		align-items: center;
	}

	.commit-card__avatar {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		inline-size: 2.4rem;
		block-size: 2.4rem;
		font-size: var(--gl-font-sm);
		font-weight: 600;
		color: var(--gl-color-fg-muted);
		background: var(--gl-color-neutral-bg);
		border-radius: var(--gl-radius-circle);
	}

	.commit-card__author {
		font-size: var(--gl-font-md);
		font-weight: 600;
		color: var(--gl-color-fg);
	}

	.commit-card__timestamp {
		margin-inline-start: auto;
		font-size: var(--gl-font-sm);
		color: var(--gl-color-fg-muted);
	}

	.commit-card__message {
		margin: 0;
		font-size: var(--gl-font-base);
		color: var(--gl-color-fg);
	}

	.commit-card__meta {
		display: flex;
		gap: var(--gl-space-8);
		align-items: center;
	}

	.commit-card__sha {
		padding: var(--gl-space-2) var(--gl-space-6);
		font-family: var(--vscode-editor-font-family, monospace);
		font-size: var(--gl-font-sm);
		color: var(--gl-color-fg-muted);
		background: var(--gl-color-surface-code);
		border-radius: var(--gl-radius-sm);
	}

	.commit-card__files {
		font-size: var(--gl-font-sm);
		color: var(--gl-color-fg-subtle);
	}

	.commit-card__stats {
		display: flex;
		gap: var(--gl-space-6);
		margin-inline-start: auto;
		font-family: var(--vscode-editor-font-family, monospace);
		font-size: var(--gl-font-sm);
	}

	.commit-card__added {
		color: var(--gl-color-diff-added);
	}

	.commit-card__modified {
		color: var(--gl-color-diff-modified);
	}

	.commit-card__removed {
		color: var(--gl-color-diff-removed);
	}

	.commit-card__actions {
		display: flex;
		gap: var(--gl-space-8);
		align-items: center;
		padding-block-start: var(--gl-space-8);
		border-block-start: var(--gl-border-width) solid var(--gl-color-border-subtle);
	}

	/* ── File list ────────────────────────────────────────────────────────── */

	.file-list {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border: var(--gl-border-width) solid var(--gl-color-border-subtle);
		border-radius: var(--gl-radius-md);
	}

	.file-row {
		display: flex;
		gap: var(--gl-space-8);
		align-items: center;
		padding: var(--gl-space-4) var(--gl-space-8);
		font-size: var(--gl-font-md);
	}

	.file-row:hover,
	.file-row--hover {
		background: var(--gl-color-surface-hover);
	}

	.file-row--selected {
		color: var(--gl-color-surface-selected-fg);
		background: var(--gl-color-surface-selected);
	}

	.file-row--selected .file-row__path {
		color: inherit;
		opacity: 0.7;
	}

	.file-row__status {
		flex-shrink: 0;
		inline-size: 1.6rem;
		font-family: var(--vscode-editor-font-family, monospace);
		font-weight: 600;
	}

	.file-row__status--modified {
		color: var(--gl-color-diff-modified);
	}

	.file-row__status--added {
		color: var(--gl-color-diff-added);
	}

	.file-row__status--removed {
		color: var(--gl-color-diff-removed);
	}

	.file-row__name {
		flex-shrink: 0;
		color: var(--gl-color-fg);
	}

	.file-row__path {
		flex: 1;
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: var(--gl-font-sm);
		color: var(--gl-color-fg-subtle);
		white-space: nowrap;
	}

	.file-row__count {
		flex-shrink: 0;
		padding: 0 var(--gl-space-6);
		font-size: var(--gl-font-sm);
		color: var(--gl-color-fg-muted);
		background: var(--gl-color-neutral-bg);
		border-radius: var(--gl-radius-circle);
	}

	/* ── Form fields ──────────────────────────────────────────────────────── */

	.pattern-field-group {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-12);
	}

	.pattern-field {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-4);
		align-items: flex-start;
	}

	.pattern-field__label {
		font-size: var(--gl-font-md);
		font-weight: 600;
		color: var(--gl-color-fg);
	}

	.pattern-field__help {
		font-size: var(--gl-font-sm);
		color: var(--gl-color-fg-muted);
	}

	.pattern-field__error {
		display: inline-block;
		padding: var(--gl-space-2) var(--gl-space-6);
		font-size: var(--gl-font-sm);
		color: var(--gl-color-danger);
		background: var(--gl-color-danger-bg);
		border-radius: var(--gl-radius-sm);
	}

	.pattern-field__checkbox {
		display: flex;
		gap: var(--gl-space-6);
		align-items: center;
		font-size: var(--gl-font-md);
		color: var(--gl-color-fg);
		cursor: pointer;
	}

	.pattern-field__checkbox input {
		accent-color: var(--gl-color-accent);
	}

	.pattern-field__checkbox--disabled {
		color: var(--gl-color-fg-disabled);
		cursor: default;
	}

	/* ── Grouped work list ────────────────────────────────────────────────── */

	.work-list {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-16);
	}

	.work-group__header {
		margin-block-end: var(--gl-space-4);
		font-size: var(--gl-font-micro);
		font-weight: 600;
		color: var(--gl-color-fg-muted);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.work-row {
		display: flex;
		gap: var(--gl-space-8);
		align-items: center;
		padding-block: var(--gl-space-6);
	}

	.work-row:not(:last-child) {
		border-block-end: var(--gl-border-width) solid var(--gl-color-border-subtle);
	}

	.work-row__title {
		flex: 1;
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: var(--gl-font-md);
		color: var(--gl-color-fg);
		white-space: nowrap;
	}

	.work-row__ref {
		flex-shrink: 0;
		font-size: var(--gl-font-sm);
		color: var(--gl-color-fg-subtle);
	}

	.work-row__tracking {
		flex-shrink: 0;
		font-family: var(--vscode-editor-font-family, monospace);
		font-size: var(--gl-font-sm);
	}

	.work-row__tracking--ahead {
		color: var(--gl-color-tracking-ahead);
	}

	.work-row__tracking--behind {
		color: var(--gl-color-tracking-behind);
	}

	/* ── Brand & AI ───────────────────────────────────────────────────────── */

	.brand-card {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-8);
		padding: var(--gl-space-12) var(--gl-space-16);
		background: var(--gl-gradient-brand-subtle);
		border: var(--gl-border-width) solid var(--gl-color-border);
		border-radius: var(--gl-radius-md);
	}

	.brand-card__top {
		display: flex;
		gap: var(--gl-space-8);
		align-items: center;
	}

	.brand-card__title {
		font-weight: 600;
		color: var(--gl-color-fg);
	}

	.brand-card__badge {
		padding: 0 var(--gl-space-6);
		font-size: var(--gl-font-micro);
		font-weight: 700;
		color: var(--gl-color-brand-on);
		letter-spacing: 0.06em;
		background: var(--gl-color-brand);
		border-radius: var(--gl-radius-sm);
	}

	.brand-card__cta {
		align-self: flex-start;
		color: var(--gl-color-brand-on);
		background: var(--gl-gradient-brand);
	}

	.brand-card__divider {
		border-block-start: var(--gl-border-width) solid var(--gl-color-border-subtle);
	}

	.brand-card__ai {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-8);
	}

	.brand-card__ai-bar {
		inline-size: 100%;
		block-size: 0.3rem;
		background: linear-gradient(to right, var(--gl-color-ai-1), var(--gl-color-ai-2), var(--gl-color-ai-3));
		border-radius: var(--gl-radius-circle);
	}

	.brand-card__ai-status {
		display: flex;
		gap: var(--gl-space-8);
		align-items: center;
	}

	.brand-card__ai-rows {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-4);
	}

	@keyframes pattern-ai-pulse {
		from {
			opacity: 1;
		}

		to {
			opacity: 0.4;
		}
	}

	.brand-card__ai-dot {
		inline-size: 0.8rem;
		block-size: 0.8rem;
		border-radius: var(--gl-radius-circle);
	}

	.brand-card__ai-dot--working {
		background: var(--gl-color-agent-working);
		animation: pattern-ai-pulse var(--gl-duration-x-slow) var(--gl-ease-in-out) infinite alternate;
	}

	.brand-card__ai-dot--waiting {
		background: var(--gl-color-agent-waiting);
	}

	.brand-card__ai-dot--idle {
		background: var(--gl-color-agent-idle);
	}

	@media (prefers-reduced-motion: reduce) {
		.brand-card__ai-dot--working {
			opacity: 1;
			animation: none;
		}
	}

	.brand-card__ai-label {
		font-size: var(--gl-font-md);
		color: var(--gl-color-fg-muted);
	}

	.brand-card__ai-summary {
		margin: 0;
		font-size: var(--gl-font-md);
		color: var(--gl-color-fg);
	}

	/* ── Empty state ──────────────────────────────────────────────────────── */

	.empty-state {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-8);
		align-items: center;
		padding-block: var(--gl-space-24);
		text-align: center;
	}

	.empty-state__icon {
		font-size: 3.2rem;
		color: var(--gl-color-fg-faint);
	}

	.empty-state__heading {
		margin: 0;
		font-size: var(--gl-font-base);
		font-weight: 600;
		color: var(--gl-color-fg);
	}

	.empty-state__body {
		margin: 0;
		font-size: var(--gl-font-md);
		color: var(--gl-color-fg-muted);
	}

	.empty-state__hint {
		margin: 0;
		font-size: var(--gl-font-sm);
		color: var(--gl-color-fg-subtle);
	}

	/* ── Activity heatmap ─────────────────────────────────────────────────── */

	.heatmap {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-8);
	}

	.heatmap__caption {
		margin: 0;
		font-size: var(--gl-font-sm);
		color: var(--gl-color-fg-muted);
	}

	.heatmap__grid {
		display: grid;
		grid-template-rows: repeat(7, 1.2rem);
		grid-auto-columns: 1.2rem;
		grid-auto-flow: column;
		gap: var(--gl-space-2);
		inline-size: fit-content;
	}

	.heat-cell {
		inline-size: 1.2rem;
		block-size: 1.2rem;
		border-radius: var(--gl-radius-xs);
	}

	.heat-cell--05 {
		background: var(--gl-color-ramp-05);
	}

	.heat-cell--10 {
		background: var(--gl-color-ramp-10);
	}

	.heat-cell--20 {
		background: var(--gl-color-ramp-20);
	}

	.heat-cell--30 {
		background: var(--gl-color-ramp-30);
	}

	.heat-cell--40 {
		background: var(--gl-color-ramp-40);
	}

	.heat-cell--50 {
		background: var(--gl-color-ramp-50);
	}

	.heat-cell--60 {
		background: var(--gl-color-ramp-60);
	}

	.heat-cell--70 {
		background: var(--gl-color-ramp-70);
	}

	.heat-cell--80 {
		background: var(--gl-color-ramp-80);
	}

	.heat-cell--90 {
		background: var(--gl-color-ramp-90);
	}

	.heat-cell--95 {
		background: var(--gl-color-ramp-95);
	}

	.heatmap__legend {
		display: flex;
		gap: var(--gl-space-4);
		align-items: center;
		font-size: var(--gl-font-sm);
		color: var(--gl-color-fg-subtle);
	}

	/* ── Split panes ──────────────────────────────────────────────────────── */

	.split-panes {
		display: flex;
		block-size: 16rem;
		overflow: hidden;
		border: var(--gl-border-width) solid var(--gl-color-border-subtle);
		border-radius: var(--gl-radius-md);
	}

	.split-panes__sidebar {
		display: flex;
		flex: 0 0 40%;
		flex-direction: column;
		gap: var(--gl-space-2);
		padding: var(--gl-space-8);
		background: var(--gl-color-surface-sunken);
	}

	.split-nav-row {
		display: flex;
		align-items: center;
		padding: var(--gl-space-2) var(--gl-space-8);
		font-size: var(--gl-font-md);
		color: var(--gl-color-fg);
		border-radius: var(--gl-radius-sm);
	}

	.split-nav-row--muted {
		color: var(--gl-color-fg-muted);
	}

	.split-nav-row__count {
		padding: 0 var(--gl-space-6);
		margin-inline-start: auto;
		font-size: var(--gl-font-sm);
		color: var(--gl-color-fg-on-emphasis);
		background: var(--gl-color-accent);
		/* Same HC treatment as .pattern-btn — the accent fill is flat black/white in HC */
		border: var(--gl-border-width) solid var(--gl-color-border-contrast, transparent);
		border-radius: var(--gl-radius-circle);
	}

	.split-sash {
		flex: none;
		inline-size: 0.4rem;
		cursor: col-resize;
		background: var(--gl-color-border-subtle);
	}

	.split-sash:hover,
	.split-sash--hover {
		background: var(--gl-color-border-sash-hover);
	}

	.split-panes__content {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: var(--gl-space-4);
		padding: var(--gl-space-8) var(--gl-space-12);
		background: var(--gl-color-surface);
	}

	.split-panes__heading {
		margin: 0;
		font-size: var(--gl-font-md);
		font-weight: 600;
		color: var(--gl-color-fg);
	}

	.split-panes__line {
		margin: 0;
		font-size: var(--gl-font-sm);
		color: var(--gl-color-fg-muted);
	}

	/* ── Surface hierarchy ────────────────────────────────────────────────── */

	.surface-map {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-12);
		padding: var(--gl-space-12);
		font-size: var(--gl-font-md);
		color: var(--gl-color-fg-muted);
		background: var(--gl-color-surface);
		border: var(--gl-border-width) solid var(--gl-color-border-subtle);
		border-radius: var(--gl-radius-md);
	}

	.surface-map__row {
		display: flex;
		gap: var(--gl-space-8);
		align-items: baseline;
		justify-content: space-between;
	}

	.surface-map__name {
		font-family: var(--vscode-editor-font-family, monospace);
		font-size: var(--gl-font-sm);
		color: var(--gl-color-fg-faint);
		white-space: nowrap;
	}

	.surface-map__sunken {
		display: flex;
		gap: var(--gl-space-8);
		align-items: baseline;
		justify-content: space-between;
		padding: var(--gl-space-8) var(--gl-space-12);
		background: var(--gl-color-surface-sunken);
		border-radius: var(--gl-radius-sm);
	}

	.surface-map__raised {
		--gl-elevation: var(--gl-shadow-raised);
		--gl-elevation-border-color: var(--gl-color-border);

		display: flex;
		flex-direction: column;
		gap: var(--gl-space-8);
		padding: var(--gl-space-8) var(--gl-space-12);
		background: var(--gl-color-surface-raised);
		border-radius: var(--gl-radius-md);
		${elevatedSurface}
	}

	.surface-map__code {
		display: flex;
		gap: var(--gl-space-8);
		justify-content: space-between;
		padding: var(--gl-space-4) var(--gl-space-8);
		background: var(--gl-color-surface-code);
		border-radius: var(--gl-radius-sm);
	}

	.surface-map__code code {
		font-family: var(--vscode-editor-font-family, monospace);
		font-size: var(--gl-font-sm);
		color: var(--gl-color-fg);
	}

	.surface-map__list {
		display: flex;
		flex-direction: column;
	}

	.surface-map__item {
		display: flex;
		gap: var(--gl-space-8);
		justify-content: space-between;
		padding: var(--gl-space-4) var(--gl-space-8);
		border-radius: var(--gl-radius-sm);
	}

	.surface-map__item--hover {
		background: var(--gl-color-surface-hover);
	}

	.surface-map__item--selected {
		color: var(--gl-color-surface-selected-fg);
		background: var(--gl-color-surface-selected);
	}

	.surface-map__item--selected .surface-map__name {
		color: inherit;
		opacity: 0.7;
	}

	/* ── Highlight & modes ────────────────────────────────────────────────── */

	.mode-demo {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-8);
	}

	.mode-banner {
		display: flex;
		gap: var(--gl-space-8);
		align-items: center;
		padding: var(--gl-space-4) var(--gl-space-12);
		color: var(--gl-color-highlight);
		background: color-mix(in srgb, var(--gl-color-highlight) 10%, transparent);
		border-block: var(--gl-border-width) solid color-mix(in srgb, var(--gl-color-highlight) 50%, transparent);
	}

	.mode-banner__label {
		font-size: var(--gl-font-md);
		color: var(--gl-color-fg);
	}

	.mode-banner__hint {
		margin-inline-start: auto;
		font-size: var(--gl-font-sm);
		color: var(--gl-color-fg-muted);
	}

	.rebase-rows {
		display: flex;
		flex-direction: column;
	}

	.rebase-row {
		display: flex;
		gap: var(--gl-space-8);
		align-items: center;
		padding: var(--gl-space-4) var(--gl-space-8);
		font-size: var(--gl-font-md);
		border-inline-start: 0.3rem solid transparent;
	}

	.rebase-row--current {
		background: color-mix(in srgb, var(--gl-color-highlight) 10%, transparent);
		border-inline-start-color: var(--gl-color-highlight);
	}

	.rebase-row__verb {
		flex-shrink: 0;
		min-inline-size: 4.8rem;
		font-family: var(--vscode-editor-font-family, monospace);
		font-size: var(--gl-font-sm);
		color: var(--gl-color-fg-muted);
	}

	.rebase-row__message {
		color: var(--gl-color-fg);
	}

	/* ── Status banners ───────────────────────────────────────────────────── */

	.banner-stack {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-8);
	}

	.banner {
		display: flex;
		gap: var(--gl-space-8);
		align-items: baseline;
		padding: var(--gl-space-8) var(--gl-space-12);
		font-size: var(--gl-font-md);
		border: var(--gl-border-width) solid;
		border-radius: var(--gl-radius-sm);
	}

	.banner code-icon {
		align-self: center;
	}

	.banner__title {
		flex-shrink: 0;
		font-weight: 600;
	}

	.banner__body {
		flex: 1;
		color: var(--gl-color-fg);
	}

	.banner--info {
		color: var(--gl-color-info);
		background: var(--gl-color-info-bg);
		border-color: var(--gl-color-info-border);
	}

	.banner--success {
		color: var(--gl-color-success);
		background: var(--gl-color-success-bg);
		border-color: var(--gl-color-success-border);
	}

	.banner--warning {
		color: var(--gl-color-warning);
		background: var(--gl-color-warning-bg);
		border-color: var(--gl-color-warning-border);
	}

	.banner--danger {
		color: var(--gl-color-danger);
		background: var(--gl-color-danger-bg);
		border-color: var(--gl-color-danger-border);
	}

	/* ── Dialog over scrim ────────────────────────────────────────────────── */

	.dialog-demo {
		position: relative;
		block-size: 22rem;
		overflow: hidden;
		border: var(--gl-border-width) solid var(--gl-color-border-subtle);
		border-radius: var(--gl-radius-md);
		isolation: isolate;
	}

	.dialog-demo__backdrop {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-8);
		padding: var(--gl-space-12);
	}

	.dialog-demo__row {
		font-size: var(--gl-font-md);
		color: var(--gl-color-fg-muted);
	}

	.dialog-demo__scrim {
		position: absolute;
		inset: 0;
		background: var(--gl-color-scrim);
	}

	.dialog-demo__center {
		position: absolute;
		inset: 0;
		display: grid;
		place-content: center;
		padding: var(--gl-space-16);
	}

	.dialog-demo__box {
		--gl-elevation: var(--gl-shadow-dialog);
		--gl-elevation-border-color: var(--gl-color-border);

		display: flex;
		flex-direction: column;
		gap: var(--gl-space-8);
		inline-size: 28rem;
		max-inline-size: 100%;
		padding: var(--gl-space-16);
		background: var(--gl-color-surface-raised);
		border-radius: var(--gl-radius-lg);
		${elevatedSurface}
	}

	.dialog-demo__title {
		margin: 0;
		font-size: var(--gl-font-base);
		font-weight: 600;
		color: var(--gl-color-fg);
	}

	.dialog-demo__body {
		margin: 0;
		font-size: var(--gl-font-md);
		color: var(--gl-color-fg-muted);
	}

	.dialog-demo__actions {
		display: flex;
		gap: var(--gl-space-8);
		justify-content: flex-end;
	}
`;
