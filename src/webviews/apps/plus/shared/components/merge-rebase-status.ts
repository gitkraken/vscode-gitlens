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
	describePausedOperationCommit,
	getPausedOperationAbortLabel,
	getPausedOperationBarActionLabel,
	getPausedOperationBarIconTooltip,
	getPausedOperationBarLabel,
	getPausedOperationSkipDetail,
	getPausedOperationSkipLabel,
	getPausedOperationStepTooltipParts,
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

			/* The phrase never shrinks — width pressure goes to the refs, which shrink and then drop. */
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

			/* Under width pressure the refs are the first thing to go: the branch row directly below the
			   strip already names the branch, and the leading icon's hover names the operands, so the
			   phrase and the actions never lose room. The threshold is where the chips stop being able to
			   NAME their refs — slivers are worse than absence. Every variant sheds, including pending,
			   whose leading "of" rides inside the group so its phrase still reads once they're gone. */
			@container (max-width: 52rem) {
				.refs {
					display: none;
				}

				/* Refs gone, the phrase is the only thing left that can absorb the squeeze — ellipsize it
				   rather than let the label's overflow clip it mid-word. */
				.label__phrase {
					flex: 0 1 auto;
					min-width: 0;
					overflow: hidden;
					text-overflow: ellipsis;
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
				min-width: 0;
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

			/* Tooltip structure shared with the graph header: action line, rule, identifying detail */
			hr {
				margin: var(--gl-space-8) 0;
				border: none;
				border-top: var(--gl-border-width) solid var(--vscode-widget-border, var(--vscode-foreground));
				opacity: 0.4;
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

	/** An automatic rebase session owns this paused rebase — continue continues in the vein it started:
	 *  the primary action resumes the automatic run and the manual continue demotes to a secondary.
	 *  Only meaningful alongside `ai-resume`. */
	@property({ type: Boolean, attribute: 'ai-active' })
	aiActive = false;

	/** Whether the working tree has anything staged. Mirrors the takeover loop's own
	 *  `hasStagedChanges()` gate, so the "Continue using Automatic Rebase" affordance matches what a takeover would
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

	/** The host reports a continue/skip still running for this repo. `<op> --continue` blocks for as long
	 *  as git's commit-message tab stays open — unbounded — so only the host can say when it ends; a
	 *  timer here could only guess, and guessing wrong re-enables an action whose click can do nothing.
	 *  Hosts that don't report it leave the busy state to the fresh-status reset below. */
	@property({ type: Boolean, attribute: 'continuing' })
	continuing = false;

	/** Set when Continue is clicked, so the action goes busy before the host's first update lands. */
	@state()
	private _continuing = false;

	/** Last-resort backstop for hosts that report neither `continuing` nor a fresh `pausedOpStatus` after a
	 *  continue settles — without it the action could strand disabled with nothing left to click. Long
	 *  enough that it can't cut short a real wait on the commit-message tab, and it never overrides a host
	 *  that says the command is still running. */
	private static readonly continuingBackstopMs = 300000;
	private _continuingTimer: ReturnType<typeof setTimeout> | undefined;

	override disconnectedCallback(): void {
		this.clearContinuing();
		super.disconnectedCallback?.();
	}

	protected override willUpdate(changedProperties: PropertyValues<this>): void {
		// Drop the optimistic state once the host reports the command settled — including a continue that
		// failed without moving the repo, so the action can't strand disabled. Hosts that don't report
		// `continuing` at all fall back to a fresh status as the settle signal.
		if (!this.continuing && (changedProperties.has('continuing') || changedProperties.has('pausedOpStatus'))) {
			this.clearContinuing();
		}

		super.willUpdate(changedProperties);
	}

	private clearContinuing(): void {
		clearTimeout(this._continuingTimer);
		this._continuingTimer = undefined;
		this._continuing = false;
	}

	/** Busy while either the click's optimistic state or the host's in-flight report holds. */
	private get isContinuing(): boolean {
		return this.continuing || this._continuing;
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
		const stepped = isPausedOperationStepped(status, variant) ? status : undefined;

		return html`
			<span class="status" part="base" data-variant=${variant}>
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
			><span class="label__text label__phrase ${variant === 'conflicts' ? 'label__text--emphasized' : ''}"
				>${label}</span
			>${stepped != null ? this.renderStep(stepped) : nothing}${this.renderRefs(
				status,
				// Pending's phrase reads straight into its refs ("Pending rebase" + "of <feature> onto <main>"),
				// so it leads with that "of" where every other variant leads with a separator.
				variant === 'pending' ? 'of' : '·',
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

		const parts = getPausedOperationStepTooltipParts(status);
		return html`${at}<gl-tooltip
				><a href=${this.createJumpUrl(commit)} class="steps chip">${steps}</a
				><span slot="content"
					>${this.getJumpLabel('paused-commit')}
					<hr />
					${parts.detail}${parts.subject ? html`<br />${parts.subject}` : nothing}</span
				></gl-tooltip
			>`;
	}

	private renderRefs(status: GitPausedOperationStatus, lead: '·' | 'of') {
		const strings = pausedOperationStatusStringsByType[status.type];
		// Never null in practice: `current` is required on non-rebase models, `onto` on rebase.
		const current = getConflictCurrentRef(status)!;

		// The leading token lives inside the group so nothing dangles when it drops at narrow widths —
		// neither a separator nor the preposition the pending phrase would otherwise trail off with.
		return html`<span class="refs"
			>${
				lead === '·' ? html`<span class="separator">·</span>` : html`<span class="label__text">of</span>`
			}${this.renderReference(status.incoming)}<span>${strings.directionality}</span>${this.renderReference(current)}</span
		>`;
	}

	private renderReference(ref: GitReference) {
		const isBranch = ref.refType === 'branch';
		const content = isBranch
			? html`<gl-branch-name .name=${ref.name} .size=${12}></gl-branch-name>`
			: html`<gl-commit-sha .sha=${ref.ref} .size=${12}></gl-commit-sha>`;

		// Read-only: plain ref text, no jump-to-branch/commit link or tooltip.
		if (this.readOnly) return content;

		// The detail line carries the untruncated identity, since the chip itself may be squeezed
		const detail = ref.refType === 'revision' ? (describePausedOperationCommit(ref) ?? ref.ref) : ref.name;

		return html`<gl-tooltip>
			<a href=${this.createJumpUrl(ref)} class="chip">${content}</a>
			<span slot="content"
				>${this.getJumpLabel(isBranch ? 'branch' : 'commit')}
				<hr />
				${detail}</span
			>
		</gl-tooltip>`;
	}

	private getJumpLabel(kind: 'branch' | 'commit' | 'paused-commit'): string {
		const webviewId = this._webview.webviewId;
		const isInGraph = webviewId === 'gitlens.graph' || webviewId === 'gitlens.views.graph';

		const noun = kind === 'branch' ? 'Branch' : kind === 'commit' ? 'Commit' : 'Paused Commit';
		return isInGraph ? `Jump to ${noun}` : `Open ${noun} in Commit Graph`;
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
	private onContinue = (e: Event): void => {
		// The button keeps its href while busy so `gl-button` reuses its inner anchor — dropping the href
		// swaps that anchor for a `<button>`, which discards keyboard focus. So the repeat activation is
		// cancelled here instead: `disabled` stops the pointer, and Enter on a focused link fires a click
		// we can preventDefault.
		if (this.isContinuing) {
			e.preventDefault();
			return;
		}

		this._continuing = true;
		this._continuingTimer = setTimeout(() => {
			// A host reporting an in-flight command outranks the backstop — its `continuing` clears this.
			if (this.continuing) return;

			this.clearContinuing();
		}, GlMergeConflictWarning.continuingBackstopMs);
	};

	private renderActions(status: GitPausedOperationStatus, variant: PausedOperationVariant) {
		const type = status.type;
		// The AI continue mirrors the takeover loop's own gate (`resumingThisStep ||
		// hasStagedChanges()`): with conflicts it resolves them, and with a staged resolution it
		// continues and keeps resolving the REMAINING steps — so hiding it once the user stages an
		// escalated step would strand them on plain "Continue", which ends automation for the rest of
		// the run. Still hidden for a genuine non-conflict stop (an interactive edit/break with nothing
		// staged), where a takeover has nothing to continue and would only escalate.
		const aiRebase = type === 'rebase' && this.aiResume && (this.conflicts || this.hasStagedChanges);
		// Continue continues in the vein the rebase started: with an automatic session active the
		// primary resumes it, and the manual continue becomes the secondary instead of the sparkle.
		const aiPrimary = type === 'rebase' && this.aiResume && this.aiActive && variant !== 'conflicts';

		return html`<action-nav class="actions">
			${this.renderPrimaryAction(status, variant, aiPrimary)}
			${when(
				aiPrimary,
				() =>
					html`<action-item
						label="Continue Rebase Manually"
						href=${this.onContinueUrl}
						icon="gl-continue"
					></action-item>`,
			)}
			${when(
				aiRebase && !aiPrimary,
				() =>
					html`<action-item
						label=${this.aiActive ? 'Continue Automatic Rebase' : 'Continue using Automatic Rebase'}
						href=${this.onContinueWithAiUrl}
						icon="gl-continue-sparkle"
					></action-item>`,
			)}
			${when(
				type === 'rebase',
				() =>
					html`<action-item
						label="Open in Rebase Editor"
						href=${this.onOpenEditorUrl}
						icon="edit"
					></action-item>`,
			)}
			${when(type !== 'merge', () => this.renderSkipAction(status))}
			<action-item
				label=${getPausedOperationAbortLabel(status)}
				href=${this.onAbortUrl}
				icon="gl-abort"
			></action-item>
		</action-nav>`;
	}

	private renderSkipAction(status: GitPausedOperationStatus) {
		const label = getPausedOperationSkipLabel(status);
		const detail = getPausedOperationSkipDetail(status);

		return html`<action-item label=${label} icon="gl-skip" href=${this.onSkipUrl}
			>${
				detail != null
					? html`<span slot="tooltip"
							>${label}
							<hr />
							${detail}</span
						>`
					: nothing
			}</action-item
		>`;
	}

	/** One obvious next step per state. Continue renders only in ready/pending, which structurally keeps
	 *  a conflicted rebase from offering a `--continue` that can't succeed; a revert's continue is no
	 *  longer excluded — `revert --continue` is supported end to end. */
	private renderPrimaryAction(status: GitPausedOperationStatus, variant: PausedOperationVariant, aiPrimary: boolean) {
		if (variant !== 'conflicts') {
			const continuing = this.isContinuing;
			const label = continuing
				? aiPrimary
					? 'Continuing Automatic Rebase…'
					: `Continuing ${pausedOperationStatusStringsByType[status.type].name}…`
				: aiPrimary
					? 'Continue Automatic Rebase'
					: getPausedOperationBarActionLabel(status, variant, this.conflictsCount);

			// One template across both states, and the href kept even while busy, so Lit reuses the button
			// AND `gl-button` reuses its inner anchor (no href swaps that anchor for a `<button>`, which
			// discards keyboard focus). `disabled` stops the pointer and drops it from the tab order without
			// blurring it; `onContinue` cancels the repeat navigation. `aria-busy` carries the state change.
			const button = html`<gl-button
				density="compact"
				?disabled=${continuing}
				aria-busy=${continuing ? 'true' : nothing}
				href=${aiPrimary ? this.onContinueWithAiUrl : this.onContinueUrl}
				@click=${this.onContinue}
				>${
					continuing ? html`<code-icon icon="loading" modifier="spin" slot="prefix"></code-icon>` : nothing
				}${label}</gl-button
			>`;

			// A disabled action can't explain itself, and the commonest reason a continue runs long is git
			// waiting on a commit-message tab the user can't see from here — so name it while busy.
			if (!continuing) return button;

			return html`<gl-tooltip
				content="Waiting for Git to finish. If a commit message tab is open, save and close it to continue."
				>${button}</gl-tooltip
			>`;
		}

		const label = getPausedOperationBarActionLabel(status, variant, this.conflictsCount);

		// With AI resolve available (graph host), the action enters Resolve Conflicts mode.
		// Elsewhere it falls back to revealing the conflicts in the tree / rebase editor.
		if (this.aiResolve) {
			return html`<gl-button density="compact" @click=${this.onResolveWithAI}>${label}</gl-button>`;
		}

		return html`<gl-button density="compact" href=${this.onShowConflictsUrl}>${label}</gl-button>`;
	}
}
