import { consume } from '@lit/context';
import type { PropertyValues } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { GitPausedOperationStatus, GitRebaseStatus } from '@gitlens/git/models/pausedOperationStatus.js';
import type { GitReference } from '@gitlens/git/models/reference.js';
import type { PausedOperationVariant } from '@gitlens/git/utils/pausedOperationStatus.utils.js';
import {
	getConflictCurrentRef,
	getPausedOperationVariant,
	pausedOperationStatusStringsByType,
	pausedOperationVariantIcons,
} from '@gitlens/git/utils/pausedOperationStatus.utils.js';
import type { ContinueRebaseWithAiCommandArgs } from '../../../../../commands/autoRebase.js';
import { createCommandLink } from '../../../../../system/commands.js';
import type { ShowInCommitGraphCommandArgs } from '../../../../plus/graph/registration.js';
import type { WebviewContext } from '../../../shared/contexts/webview.js';
import { webviewContext } from '../../../shared/contexts/webview.js';
import {
	getPausedOperationAbortLabel,
	getPausedOperationBarActionLabel,
	getPausedOperationBarIconTooltip,
	getPausedOperationBarLabel,
	getPausedOperationSkipLabel,
	getPausedOperationStepTooltip,
	isPausedOperationStepped,
} from './merge-rebase-status.utils.js';
import '../../../shared/components/actions/action-item.js';
import '../../../shared/components/actions/action-nav.js';
import '../../../shared/components/branch-name.js';
import '../../../shared/components/button.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/commit-sha.js';
import '../../../shared/components/overlays/tooltip.js';

@customElement('gl-merge-rebase-status')
export class GlMergeConflictWarning extends LitElement {
	static override styles = [
		css`
			.status {
				/* The strip's background is a fixed decoration color, not a theme color, so its chips can't
				   derive from the theme either. Lightening reads on all four variants where a currentColor
				   tint muddied the amber/green fills, so chips/pills/buttons are white overlays carrying
				   dark ink whatever the strip's own text color is. */
				--gl-paused-op-chip: rgb(255 255 255 / 0.45);
				--gl-paused-op-chip-hover: rgb(255 255 255 / 0.6);
				--gl-paused-op-ink: #1a1a1a;
				--action-item-foreground: #000;
				--action-item-hover-background: var(--gl-paused-op-chip);
				--action-item-active-background: var(--gl-paused-op-chip-hover);

				box-sizing: border-box;
				container-type: inline-size;
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
				width: 100%;
				max-width: 100%;
				min-height: 2.4rem;
				padding: 0.2rem 0.4rem 0.2rem 0.6rem;
				margin-block: 0;
				color: #000;
				background-color: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingForegroundColor);
				border-radius: var(--gl-radius-sm);
			}

			.status[data-variant='conflicts'] {
				--action-item-foreground: #fff;

				color: #fff;
				background-color: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingConflictForegroundColor);
			}

			.status[data-variant='ready'] {
				--action-item-foreground: #06150a;

				color: #06150a;
				background-color: var(--vscode-gitlens-decorations\\.statusPausedOperationReadyForegroundColor);
			}

			/* The light theme's green is dark enough to carry white text; dark's is not. */
			:host-context(.vscode-light) .status[data-variant='ready'],
			:host-context(.vscode-high-contrast-light) .status[data-variant='ready'] {
				--action-item-foreground: #fff;

				color: #fff;
			}

			.label {
				display: flex;
				flex: 1;
				gap: var(--gl-space-4);
				align-items: center;
				min-width: 0;
				overflow: hidden;
				white-space: nowrap;
			}

			/* The phrase never shrinks — width pressure goes to the refs, which shrink and (stepped) drop. */
			.label__text {
				flex: none;
			}

			.label__text--emphasized {
				font-weight: 600;
			}

			.separator {
				flex: none;
				opacity: 0.55;
			}

			.refs {
				display: inline-flex;
				flex: 0 1 auto;
				gap: var(--gl-space-4);
				align-items: center;
				min-width: 0;
				overflow: hidden;
			}

			/* Refs absorb all the shrink, ellipsizing well past the chips' resting minimum. */
			.refs .chip {
				min-width: 0;
			}

			/* Under width pressure the refs are the first thing to go: the branch row directly below the
			   strip already names the branch and the paused-at pill's hover carries the rest, so the
			   phrase and the actions never lose room. Only stripped when a step pill is competing for it.
			   The threshold is where the chips stop being able to NAME their refs — slivers are worse
			   than absence. */
			@container (max-width: 52rem) {
				.status--stepped .refs {
					display: none;
				}
			}

			.icon,
			.actions {
				flex: none;
			}

			/* Read-only (mode) banner: baseline-align so the "at 3/7" step counter lines up with the
			   status text. The branch-name chips inflate the label's line-box, so plain center-alignment
			   leaves the counter sitting too low. Keep the leading icon centered. */
			:host([readonly]) .status {
				align-items: baseline;
			}

			:host([readonly]) .icon {
				align-self: center;
			}

			gl-commit-sha::part(label) {
				font-weight: bold;
			}

			/* The ref chips wrap atomic inline-level components, which text-decoration can't reach, so the
			   clickable affordance is the fill rather than an underline. */
			.chip {
				display: inline-flex;
				flex: 0 1 auto;
				align-items: center;
				min-width: 4ch;
				padding: 0 var(--gl-space-4);
				overflow: hidden;
				color: var(--gl-paused-op-ink);
				text-decoration: none;
				cursor: pointer;
				background-color: var(--gl-paused-op-chip);
				border-radius: var(--gl-radius-xs);

				&:hover {
					background-color: var(--gl-paused-op-chip-hover);
				}
			}

			/* The step counter is short and load-bearing — it never shrinks with the refs. */
			.steps {
				flex: none;
				min-width: auto;
				font-variant-numeric: tabular-nums;
			}

			.actions gl-button {
				--button-background: var(--gl-paused-op-chip);
				--button-hover-background: var(--gl-paused-op-chip-hover);
				--button-foreground: var(--gl-paused-op-ink);
				--button-border: color-mix(in srgb, currentColor 40%, transparent);
				--button-compact-padding: 0.1rem var(--gl-space-8);

				margin-right: var(--gl-space-2);
				font-weight: 600;
				white-space: nowrap;
			}

			.actions action-item:is(:hover, :focus-within) {
				--action-item-foreground: var(--gl-paused-op-ink);
			}
		`,
	];

	@consume({ context: webviewContext })
	private _webview!: WebviewContext;

	@property({ type: Boolean })
	conflicts = false;

	/** How many files are conflicted, when the host knows — rides on the Resolve action's label. */
	@property({ type: Number, attribute: 'conflicts-count' })
	conflictsCount?: number;

	/** Opt-in for routing the conflicts status text into Resolve Conflicts mode (fires
	 *  `ai-resolve-conflicts`). Only hosts that can handle the event (the graph WIP details) should
	 *  enable it; elsewhere the text falls back to revealing the conflicts. */
	@property({ type: Boolean, attribute: 'ai-resolve' })
	aiResolve = false;

	/** Opt-in for showing a "Resume with AI" action on a paused rebase — re-engages automatic rebase
	 *  (takeover) to finish the remaining steps. Only enabled by hosts where AI is allowed (graph). */
	@property({ type: Boolean, attribute: 'ai-resume' })
	aiResume = false;

	/** Whether the working tree has anything staged. Mirrors the takeover loop's own
	 *  `hasStagedChanges()` gate, so the "Continue Automatic Rebase" affordance matches what a takeover would
	 *  actually do on a rebase paused without conflicts. */
	@property({ type: Boolean, attribute: 'has-staged-changes' })
	hasStagedChanges = false;

	/** Render the bar as a plain status read-out — no paused-op action buttons and no clickable
	 *  conflicts text. Set by hosts that are in a mode (compose/review/resolve) so the bar doesn't
	 *  compete with the mode's own controls. */
	@property({ type: Boolean, attribute: 'readonly', reflect: true })
	readOnly = false;

	@property({ type: Object })
	pausedOpStatus?: GitPausedOperationStatus;

	/** Set when Continue is clicked; the command runs out of band, so only a fresh `pausedOpStatus`
	 *  clears it. Git blocked on a commit-message editor pushes nothing, so the spinner holding is
	 *  correct — it's waiting on the user. */
	@state()
	private _continuing = false;

	protected override willUpdate(changedProperties: PropertyValues<this>): void {
		if (changedProperties.has('pausedOpStatus')) {
			this._continuing = false;
		}

		super.willUpdate(changedProperties);
	}

	private get onSkipUrl() {
		return this.createPausedOperationCommandLink('skip');
	}

	private get onContinueUrl() {
		return this.createPausedOperationCommandLink('continue');
	}

	private get onAbortUrl() {
		return this.createPausedOperationCommandLink('abort');
	}

	private get onOpenEditorUrl() {
		return this.createPausedOperationCommandLink('open');
	}

	private get onContinueWithAiUrl() {
		return createCommandLink<ContinueRebaseWithAiCommandArgs>('gitlens.ai.continueRebase', {
			repoPath: this.pausedOpStatus?.repoPath,
			source: 'graph',
		});
	}

	private get onShowConflictsUrl() {
		return this.createPausedOperationCommandLink('showConflicts');
	}

	private createPausedOperationCommandLink(
		command: 'abort' | 'continue' | 'open' | 'showConflicts' | 'skip',
	): string {
		return this._webview.createCommandLink(`gitlens.pausedOperation.${command}:`, this.pausedOpStatus);
	}

	override render(): unknown {
		const status = this.pausedOpStatus;
		if (status == null) return nothing;

		const variant = getPausedOperationVariant(status, this.conflicts);
		// One predicate drives both the CSS gate (refs drop at narrow widths) and the step-pill render.
		const stepped = isPausedOperationStepped(status, variant) ? status : undefined;

		return html`
			<span class="status ${stepped != null ? 'status--stepped' : ''}" part="base" data-variant=${variant}>
				${this.renderIcon(status, variant)}${this.renderLabel(status, variant, stepped)}${
					// Read-only keeps the variant's copy and tint — only the affordances go away.
					this.readOnly ? nothing : this.renderActions(status, variant)
				}
			</span>
		`;
	}

	private renderIcon(status: GitPausedOperationStatus, variant: PausedOperationVariant) {
		const icon = html`<code-icon icon=${pausedOperationVariantIcons[variant]} class="icon"></code-icon>`;

		const tooltip = getPausedOperationBarIconTooltip(status, variant, this.conflictsCount);
		if (tooltip == null) return icon;

		return html`<gl-tooltip content=${tooltip}>${icon}</gl-tooltip>`;
	}

	private renderLabel(
		status: GitPausedOperationStatus,
		variant: PausedOperationVariant,
		stepped: GitRebaseStatus | undefined,
	) {
		const label = getPausedOperationBarLabel(status, variant);

		return html`<span class="label"
			><span class="label__text ${variant === 'conflicts' ? 'label__text--emphasized' : ''}">${label}</span
			>${stepped != null ? this.renderStep(stepped) : nothing}${this.renderRefs(
				status,
				// The pending phrase reads straight into its refs ("Pending rebase of <feature> onto <main>").
				variant !== 'pending',
			)}</span
		>`;
	}

	/** The step counter IS the paused-on commit — clicking it jumps to that commit, hovering it names it. */
	private renderStep(status: GitRebaseStatus) {
		const steps = `${status.steps.current.number}/${status.steps.total}`;
		const at = html`<span class="label__text">at</span>`;

		const commit = status.steps.current.commit;
		if (this.readOnly || commit == null) {
			return html`${at}<span class="steps">${steps}</span>`;
		}

		return html`${at}<gl-tooltip
				><a href=${this.createJumpUrl(commit)} class="steps chip">${steps}</a
				><span slot="content"
					>${getPausedOperationStepTooltip(status)}<br />${this.getJumpLabel(false)}</span
				></gl-tooltip
			>`;
	}

	private renderRefs(status: GitPausedOperationStatus, separator: boolean) {
		const strings = pausedOperationStatusStringsByType[status.type];
		// Never null in practice: `current` is required on non-rebase models, `onto` on rebase.
		const current = getConflictCurrentRef(status)!;

		// The leading separator lives inside the group so nothing dangles when it drops at narrow widths.
		return html`<span class="refs"
			>${separator ? html`<span class="separator">·</span>` : nothing}${this.renderReference(status.incoming)}<span>${strings.directionality}</span>${this.renderReference(current)}</span
		>`;
	}

	private renderReference(ref: GitReference) {
		const isBranch = ref.refType === 'branch';
		const content = isBranch
			? html`<gl-branch-name .name=${ref.name} .size=${12}></gl-branch-name>`
			: html`<gl-commit-sha .sha=${ref.ref} .size=${12}></gl-commit-sha>`;

		// Read-only: plain ref text, no jump-to-branch/commit link or tooltip.
		if (this.readOnly) return content;

		return html`<gl-tooltip content=${this.getJumpLabel(isBranch)}>
			<a href=${this.createJumpUrl(ref)} class="chip">${content}</a>
		</gl-tooltip>`;
	}

	private getJumpLabel(isBranch: boolean): string {
		const webviewId = this._webview.webviewId;
		const isInGraph = webviewId === 'gitlens.graph' || webviewId === 'gitlens.views.graph';

		return isInGraph
			? isBranch
				? 'Jump to Branch'
				: 'Jump to Commit'
			: isBranch
				? 'Open Branch in Commit Graph'
				: 'Open Commit in Commit Graph';
	}

	private createJumpUrl(ref: GitReference): string {
		return createCommandLink<ShowInCommitGraphCommandArgs>('gitlens.showInCommitGraph', {
			ref: ref,
			source: { source: 'merge-target' },
		});
	}

	private onResolveWithAI = (e: Event): void => {
		e.preventDefault();
		this.dispatchEvent(new CustomEvent('ai-resolve-conflicts', { bubbles: true, composed: true }));
	};

	/** Presentation only — the href's navigation still fires the command. */
	private onContinue = (): void => {
		this._continuing = true;
	};

	private renderActions(status: GitPausedOperationStatus, variant: PausedOperationVariant) {
		const type = status.type;
		// "Continue Automatic Rebase" mirrors the takeover loop's own gate (`resumingThisStep ||
		// hasStagedChanges()`): with conflicts it resolves them, and with a staged resolution it
		// continues and keeps resolving the REMAINING steps — so hiding it once the user stages an
		// escalated step would strand them on plain "Continue", which ends automation for the rest of
		// the run. Still hidden for a genuine non-conflict stop (an interactive edit/break with nothing
		// staged), where a takeover has nothing to continue and would only escalate.
		const aiRebase = type === 'rebase' && this.aiResume && (this.conflicts || this.hasStagedChanges);

		return html`<action-nav class="actions">
			${this.renderPrimaryAction(status, variant)}
			${when(
				type === 'rebase',
				() =>
					html`<action-item
						label="Open in Rebase Editor"
						href=${this.onOpenEditorUrl}
						icon="edit"
					></action-item>`,
			)}
			${when(
				aiRebase,
				() =>
					html`<action-item
						label="Continue Automatic Rebase"
						href=${this.onContinueWithAiUrl}
						icon="gl-continue-sparkle"
					></action-item>`,
			)}
			${when(
				type !== 'merge',
				() =>
					html`<action-item
						label=${getPausedOperationSkipLabel(status)}
						icon="gl-skip"
						href=${this.onSkipUrl}
					></action-item>`,
			)}
			<action-item
				label=${getPausedOperationAbortLabel(status)}
				href=${this.onAbortUrl}
				icon="gl-abort"
			></action-item>
		</action-nav>`;
	}

	/** One obvious next step per state. Continue renders only in ready/pending, which structurally keeps
	 *  a conflicted rebase from offering a `--continue` that can't succeed; a revert's continue is no
	 *  longer excluded — `revert --continue` is supported end to end. */
	private renderPrimaryAction(status: GitPausedOperationStatus, variant: PausedOperationVariant) {
		const label = getPausedOperationBarActionLabel(status, variant, this.conflictsCount);
		if (variant !== 'conflicts') {
			// No href while waiting — disabled stops the pointer, but a link still navigates on Enter.
			if (this._continuing) {
				const waiting = `Continuing ${pausedOperationStatusStringsByType[status.type].name}…`;
				return html`<gl-button density="compact" disabled
					><code-icon icon="loading" modifier="spin" slot="prefix"></code-icon>${waiting}</gl-button
				>`;
			}

			return html`<gl-button density="compact" href=${this.onContinueUrl} @click=${this.onContinue}
				>${label}</gl-button
			>`;
		}

		// With AI resolve available (graph host), the action enters Resolve Conflicts mode.
		// Elsewhere it falls back to revealing the conflicts in the tree / rebase editor.
		if (this.aiResolve) {
			return html`<gl-button density="compact" @click=${this.onResolveWithAI}>${label}</gl-button>`;
		}

		return html`<gl-button density="compact" href=${this.onShowConflictsUrl}>${label}</gl-button>`;
	}
}
