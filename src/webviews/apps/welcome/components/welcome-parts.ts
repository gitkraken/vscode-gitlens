import type { TemplateResult } from 'lit';
import { css, html, LitElement } from 'lit';
import { customElement, property, query, queryAssignedElements } from 'lit/decorators.js';
import '../../shared/components/button.js';
import '../../shared/components/code-icon.js';
import type { SubscriptionState } from '../../../../constants.subscription.js';
import type { WalkthroughContextKeys } from '../../../../constants.walkthroughs.js';

declare global {
	interface HTMLElementTagNameMap {
		'gl-walkthrough': GlWalkthrough;
		'gl-walkthrough-progress': GlWalkthroughProgress;
		'gl-walkthrough-step': GlWalkthroughStep;
	}

	interface GlobalEventHandlersEventMap {
		'gl-walkthrough-step-expand-toggled': CustomEvent<{ expanded: boolean }>;
	}
}

export type WalkthroughStepConditionState = {
	plusState: SubscriptionState | undefined;
	mcpNeedsInstall: boolean;
};

export type WalkthroughStep = {
	id: string;
	/** The key used to track completion in the walkthrough progress state */
	walkthroughKey?: WalkthroughContextKeys;
	title: string;
	body: TemplateResult;
	condition?: (state: WalkthroughStepConditionState) => boolean;
};

@customElement('gl-walkthrough-step')
export class GlWalkthroughStep extends LitElement {
	static override styles = [
		css`
			:host {
				display: block;
			}

			:host(:focus-within) {
				outline: 1px solid var(--vscode-focusBorder);
				outline-offset: -1px;
			}

			.header {
				display: flex;
				align-items: center;
				justify-content: flex-start;
				gap: 0.6em;
				cursor: pointer;
				user-select: none;
			}

			.header:hover {
				opacity: 0.8;
			}

			.header:focus {
				outline: none;
			}

			.icon {
				flex: none;
				transition: transform 0.2s ease;
			}

			:host([expanded]) .icon {
				transform: rotate(90deg);
			}

			.title {
				display: block;
			}

			.status-icon {
				flex: none;
				color: var(--vscode-descriptionForeground);
			}

			:host([completed]) .status-icon {
				color: var(--vscode-textLink-foreground);
			}

			.content {
				display: none;
				flex-direction: column;
				gap: 1em;
			}

			:host([expanded]) .content {
				display: flex;
			}
		`,
	];

	@property({ type: String })
	stepId?: string;

	@property({ type: Boolean, reflect: true })
	completed: boolean = false;

	@property({ type: Boolean, reflect: true })
	expanded: boolean = false;

	@query('.header')
	private header?: HTMLElement;

	override focus(options?: FocusOptions): void {
		this.header?.focus(options);
	}

	toggleExpanded(expanded = !this.expanded): void {
		this.expanded = expanded;

		queueMicrotask(() => {
			this.dispatchEvent(
				new CustomEvent('gl-walkthrough-step-expand-toggled', {
					detail: { expanded: expanded },
					bubbles: true,
					composed: true,
				}),
			);
		});
	}

	private handleHeaderClick(): void {
		this.toggleExpanded();
	}

	private handleHeaderKeydown(e: KeyboardEvent): void {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			this.toggleExpanded();
		}
	}

	override render(): unknown {
		return html`
			<div
				part="header"
				class="header"
				role="button"
				tabindex="0"
				aria-expanded=${this.expanded}
				@click=${this.handleHeaderClick}
				@keydown=${this.handleHeaderKeydown}
			>
				<code-icon class="status-icon" icon=${this.completed ? 'pass-filled' : 'circle-large'}></code-icon>
				<span class="title"><slot name="title"></slot></span>
				<code-icon class="icon" icon="chevron-right"></code-icon>
			</div>
			<div class="content">
				<slot></slot>
			</div>
		`;
	}
}

@customElement('gl-walkthrough')
export class GlWalkthrough extends LitElement {
	@queryAssignedElements({ selector: 'gl-walkthrough-step' })
	private steps!: GlWalkthroughStep[];

	/** The stepId of the currently expanded step, or undefined if no step is expanded */
	@property({ type: String, reflect: true, attribute: 'expanded-step-id' })
	expandedStepId?: string;

	override connectedCallback(): void {
		super.connectedCallback?.();
		this.addEventListener('gl-walkthrough-step-expand-toggled', this.onStepExpandToggled);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();
		this.removeEventListener('gl-walkthrough-step-expand-toggled', this.onStepExpandToggled);
	}

	override updated(changedProperties: Map<string, unknown>): void {
		super.updated(changedProperties);

		// When expandedStepId is changed programmatically, sync the step states
		if (changedProperties.has('expandedStepId')) {
			this.syncStepsToExpandedStepId();
		}
	}

	private readonly onStepExpandToggled = (e: GlobalEventHandlersEventMap['gl-walkthrough-step-expand-toggled']) => {
		const path = e.composedPath();
		const step = path.find(p => (p as HTMLElement).matches?.('gl-walkthrough-step')) as
			| GlWalkthroughStep
			| undefined;

		if (step == null) return;

		if (step.expanded) {
			// Step is being expanded - collapse all others and update expandedStepId
			this.steps.forEach(s => {
				if (s !== step) {
					s.expanded = false;
				}
			});
			this.expandedStepId = step.stepId;
		} else {
			// Step is being collapsed - set expandedStepId to undefined
			this.expandedStepId = undefined;
		}
	};

	private syncStepsToExpandedStepId(): void {
		// Sync step expanded states to match expandedStepId
		this.steps.forEach(step => {
			step.expanded = step.stepId != null && step.stepId === this.expandedStepId;
		});
	}

	private getDefaultStepToExpand(): GlWalkthroughStep | undefined {
		// Find first incomplete step, or first step if all complete
		const firstIncompleteStep = this.steps.find(step => !step.completed);
		return firstIncompleteStep ?? this.steps[0];
	}

	private handleSlotChange(): void {
		// Sync step states when slot content changes
		if (this.expandedStepId != null) {
			this.syncStepsToExpandedStepId();
		} else {
			// If no expandedStepId is set, check if any step is already expanded and sync
			const expandedStep = this.steps.find(step => step.expanded);
			if (expandedStep != null) {
				this.expandedStepId = expandedStep.stepId;
			} else {
				// Auto-expand first incomplete step, or first step if all complete
				const stepToExpand = this.getDefaultStepToExpand();
				if (stepToExpand?.stepId != null) {
					this.expandedStepId = stepToExpand.stepId;
				}
			}
		}
	}

	/** Resets the walkthrough to expand the default step (first incomplete, or first if all complete) and focuses it */
	async resetToDefaultAndFocus(): Promise<void> {
		const stepToExpand = this.getDefaultStepToExpand();
		if (stepToExpand?.stepId != null) {
			this.expandedStepId = stepToExpand.stepId;
			// Focus the step after the update
			await this.updateComplete;
			await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			stepToExpand.focus();
		}
	}

	override render(): unknown {
		return html`<slot @slotchange=${this.handleSlotChange}></slot>`;
	}
}

@customElement('gl-walkthrough-progress')
export class GlWalkthroughProgress extends LitElement {
	static override styles = [
		css`
			:host {
				display: block;
			}

			.progress {
				display: flex;
				flex-direction: column;
				align-items: center;
				gap: 0.5em;
				padding: 0 2em;
			}

			.progress-bar {
				width: 100%;
				height: 4px;
				background: var(--card-background);
				border-radius: 2px;
				overflow: hidden;
			}

			.progress-bar__fill {
				height: 100%;
				background: linear-gradient(to right, #7900c9, #196fff);
				border-radius: 2px;
				transition: width 0.3s ease;
			}

			p {
				margin: 0;
				color: var(--vscode-descriptionForeground);
			}
		`,
	];

	@property({ type: Number })
	doneCount: number = 0;

	@property({ type: Number })
	allCount: number = 0;

	@query('.progress-bar__fill')
	private _fillEl!: HTMLElement;

	private get progressPercent(): number {
		if (this.allCount === 0) return 0;
		return (this.doneCount / this.allCount) * 100;
	}

	override updated(): void {
		if (this._fillEl) {
			this._fillEl.style.width = `${this.progressPercent}%`;
		}
	}

	override render(): unknown {
		return html`
			<div class="progress">
				<div class="progress-bar">
					<div class="progress-bar__fill"></div>
				</div>
				<p>${this.doneCount}/${this.allCount} steps complete</p>
			</div>
		`;
	}
}
