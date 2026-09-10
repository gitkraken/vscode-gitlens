import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import * as l10n from '@vscode/l10n';
import type { TemplateResult } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import { boxSizingBase } from '@gitlens/components/components/styles/lit/base.css.js';
import { cspStyleMap } from '@gitlens/components/cspStyleMap.directive.js';
import { createCommandLink } from '../../../../../../system/commands.js';
import { resolveAiUsage } from '../../../../shared/aiUsage.js';
import type { AIContextState } from '../../../../shared/contexts/ai.js';
import { aiContext } from '../../../../shared/contexts/ai.js';
import type { SubscriptionContextState } from '../../../../shared/contexts/subscription.js';
import { subscriptionContext } from '../../../../shared/contexts/subscription.js';
import { truncateStyles } from '../../../shared/components/chipStyles.js';
import { rollupItemStyles } from '../../../shared/components/rollupItem.css.js';
import '@gitlens/components/components/codeIcon.js';

declare global {
	interface HTMLElementTagNameMap {
		'gl-ai-chip': GlAiChip;
	}
}

/**
 * AI section of the graph account rollup: the active model, then the GitKraken AI credit meter.
 *
 * The two rows are deliberately NOT merged and deliberately point somewhere different. Credits are a
 * weekly plan allowance (subscription entitlement, Settings → Account); the model is configuration
 * (Settings → AI). GitLens speaks to twelve AI providers and the credits measure exactly one of them, so
 * for most users the rows describe unrelated things that only happen to share a heading.
 *
 * Each row is therefore its own `.rollup__item` target, which is why the host indicator hands this
 * component the section body rather than wrapping it in an anchor of its own — nested links are invalid,
 * and one anchor could only lead to one of the two destinations.
 */
@customElement('gl-ai-chip')
export class GlAiChip extends SignalWatcher(LitElement) {
	// No `subscribe: true`, matching `gl-agents-chip` and `gl-integrations-chip`: the provider object is a
	// stable reference whose internal signals mutate in place, and `SignalWatcher` re-renders on those.
	@consume({ context: aiContext })
	private _ai!: AIContextState;

	// Subscribed, matching `gl-integrations-chip`: the host swaps the whole subscription context value in
	// once its RPC lands, which a signal read alone wouldn't see.
	@consume({ context: subscriptionContext, subscribe: true })
	private _subscription!: SubscriptionContextState;

	static override styles = [
		boxSizingBase,
		rollupItemStyles,
		truncateStyles,
		css`
			/* No gap of its own, which is not the same as no spacing: both rows are .rollup__item, so
			   their own 4px padding already puts 8px of air between the two runs of text — the level
			   the rhythm assigns to rows inside a section. Adding a gap on top measured 12px between
			   them, exactly what the rollup put between two different SECTIONS, so one subject read as
			   two. See the VERTICAL RHYTHM note in gl-graph-account-indicator. */
			:host {
				display: flex;
				flex-direction: column;
			}

			/* Center, not baseline: this row is one continuous phrase (glyph → model → provider) rather
			   than a label set beside a run of glyphs, and the smaller provider text sitting on a shared
			   baseline would read as a footnote dropped below the model name. */
			.model {
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
			}

			/* Same recess as the credits row's glyph below. Both are leading marks of equal rank, and
			   leaving one at full strength made the two rows read as different tiers of importance. */
			.model__icon {
				flex: none;
				color: var(--color-foreground--65);
			}

			/* Clips rather than wrapping (via .truncate on the element): model ids run long
			   ("claude-sonnet-4-5-20250929") and the popover is width-capped, so a wrap would push the
			   provider name onto its own line. */
			.model__name {
				color: var(--color-foreground);
			}

			/* Pushed to the far end and muted — where the model runs (and, for GitKraken AI, what it costs)
			   answers a follow-up question to which model is active. */
			.model__meta {
				flex: none;
				margin-left: auto;
				font-size: var(--gl-font-sm);
				color: var(--color-foreground--50);
				white-space: nowrap;
			}

			.ai {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-4);
			}

			/* Never wraps: the head's three atoms are a phrase plus its measurement, and wrapping the
			   figure onto its own line detaches it from the track it describes. The title absorbs the
			   squeeze instead (see .ai__title). */
			.ai__head {
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
			}

			.ai__icon {
				flex: none;
				color: var(--color-foreground--65);
			}

			/* min-width: 0 is what makes .truncate's ellipsis possible — a flex item's automatic minimum is
			   min-content, which would push the row wider than the popover rather than clipping.
			   --gl-font-md, not --gl-font-base: it sits level with the model row above it, which renders at
			   the panel's own inherited size. */
			.ai__title {
				flex: 1;
				min-width: 0;
				font-size: var(--gl-font-md);
			}

			/* Text carrier for the state the bar's color also shows, so "nearly out" never lives in color
			   alone (docs/accessibility.md). The row's accessible name repeats it, because that name
			   replaces this text for assistive tech. Foreground-register warning token so a hairline of
			   text still out-contrasts the panel behind it. */
			.ai__warning {
				flex: none;
				font-size: var(--gl-font-sm);
				color: var(--vscode-editorWarning-foreground, var(--vscode-charts-yellow));
				white-space: nowrap;
			}

			/* Monospaced like the full Settings card's figure, so the same number reads the same in both
			   places. */
			.ai__figure {
				flex: none;
				font-family: var(--vscode-editor-font-family);
				font-size: var(--gl-font-sm);
				color: var(--color-foreground--75);
				white-space: nowrap;
			}

			/* The card's track recipe, one step slimmer — this panel is a denser surface. */
			.ai__track {
				display: block;
				height: 0.4rem;
				overflow: hidden;
				background: color-mix(in srgb, var(--color-foreground) 12%, transparent);
				border-radius: var(--gl-radius-circle);
			}

			.ai__fill {
				display: block;
				height: 100%;
				background: var(--vscode-progressBar-background);
				border-radius: var(--gl-radius-circle);
			}

			.ai__fill--warning {
				background: var(--vscode-charts-yellow);
			}
		`,
	];

	override render(): unknown {
		const model = this.renderModelRow();
		const credits = this.renderCreditsRow();
		// An empty flex host would still take the section's gap, opening a hole where a row would be.
		if (model == null && credits == null) return nothing;

		return html`${model}${credits}`;
	}

	/**
	 * The active model named in words. `role="img"` + `aria-label` on the row's contents rather than an
	 * `aria-label` on the anchor: the row's visible pieces only mean something read together, and as
	 * separate text nodes they'd be announced as unrelated labels sharing no relationship. `role="img"`
	 * makes the row a leaf, so the one label is all that's announced — and leaving it on the contents
	 * (which is what the link's name is then computed from) keeps the anchor a link, where an
	 * `aria-label` on the anchor itself would have hidden the model name behind a generic row label.
	 *
	 * The provider is never dropped, however tight the row gets: it's the only thing distinguishing this
	 * row's subject from the credits row below it, which is also about "AI". `consumptionRateLabel` joins
	 * it when present — it exists for GitKraken AI models only, and is the rate at which the selected
	 * model burns the credits the next row meters, which is the one case where the two rows relate.
	 */
	private renderModelRow(): TemplateResult | undefined {
		const state = this._ai.state.get();
		const model = this._ai.model.get();
		if (!state.enabled || !state.orgEnabled || model == null) return undefined;

		const rate = model.consumptionRateLabel;
		const provider = model.provider.name;

		const modelLabel = rate
			? l10n.t('AI model: {name} via {provider}, {rate} — open in GitLens Settings', {
					name: model.name,
					provider: provider,
					rate: rate,
				})
			: l10n.t('AI model: {name} via {provider} — open in GitLens Settings', {
					name: model.name,
					provider: provider,
				});

		return html`<a class="rollup__item" href=${createCommandLink('gitlens.showSettingsPage!ai')}>
			<span class="model" role="img" aria-label=${modelLabel}>
				<code-icon class="model__icon" icon="sparkle-filled" aria-hidden="true"></code-icon>
				<span class="model__name truncate">${model.name}</span>
				<span class="model__meta"
					>${rate ? l10n.t('{provider} · {rate}', { provider: provider, rate: rate }) : provider}</span
				>
			</span>
		</a>`;
	}

	/**
	 * The compact GitKraken AI meter — a summary plus a way through to the full one on the Settings Account
	 * screen (issue #5743). Deliberately narrower than that card: no reset date and no organization pool,
	 * which stay exclusive to it, and a bare percentage where the card spells out the credits. Both read
	 * the same shared resolver, so the compaction can't drift into disagreeing with the card.
	 *
	 * The sentinels keep their words rather than compacting: there is no percentage of an unlimited or
	 * absent allowance, and "0%" for a plan with no allowance would read as "none of it spent yet" — the
	 * exact collapse the two sentinels exist to prevent. The accessible name keeps the full figure either
	 * way; the percentage is a space saving on a dense panel, not a decision to tell anyone less.
	 *
	 * The command resolves to a CATEGORY anchor, so this lands on the Account panel that holds the full
	 * meter — a different destination from the model row above, which goes to the AI panel.
	 */
	private renderCreditsRow(): TemplateResult | undefined {
		// The signal outlives the account it describes — a sign-out's refresh has to round-trip before it
		// clears, so without this gate the previous account's usage renders on a signed-out panel.
		if (this._subscription.subscription.get()?.account == null) return undefined;

		const usage = this._subscription.aiUsage.get();
		// `undefined` = not loaded yet, `null` = unavailable (on-premise orgs, or the fetch failed). This
		// row is supplementary to everything else in the rollup, so neither warrants a skeleton or an
		// error row.
		if (usage == null) return undefined;

		const { figure, percent, nearlyOut } = resolveAiUsage(usage);
		const compact = percent != null ? `${Math.round(percent)}%` : figure;

		// Positional {0}, not a named placeholder: both messages moved here verbatim from the account chip,
		// and matching their keys byte-for-byte keeps the Spanish and Chinese translations that already
		// exist for them attached. A name would read better but would orphan three locales to gain it.
		const creditsLabel = nearlyOut
			? l10n.t('GitKraken AI usage: {0}, nearly out — open in GitLens Settings', figure)
			: l10n.t('GitKraken AI usage: {0} — open in GitLens Settings', figure);

		// 'GitKraken AI' below is deliberately NOT wrapped in l10n.t() — it's a product name
		// (docs/localization.md), and marking it for translation risks a translator altering it.
		return html`<a
			class="rollup__item ai"
			href=${createCommandLink('gitlens.showSettingsPage!account')}
			aria-label=${creditsLabel}
		>
			<span class="ai__head">
				<code-icon class="ai__icon" icon="sparkle" aria-hidden="true"></code-icon>
				<span class="ai__title truncate">GitKraken AI</span>
				${
					nearlyOut
						? html`<span class="ai__warning"
								>${l10n.t({
									message: 'Nearly out',
									comment: ['Warns that GitKraken AI credits are nearly exhausted.'],
								})}</span
							>`
						: nothing
				}
				<span class="ai__figure">${compact}</span>
			</span>
			${
				percent != null
					? html`<span class="ai__track" aria-hidden="true"
							><span
								class="ai__fill ${nearlyOut ? 'ai__fill--warning' : ''}"
								style=${cspStyleMap({ inlineSize: `${percent}%` })}
							></span
						></span>`
					: nothing
			}
		</a>`;
	}
}
