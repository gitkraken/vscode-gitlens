import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';
import type { GraphWalkthroughProgress, WalkthroughProgress } from '../../../../constants.walkthroughs.js';
import { graphWalkthroughProgressSteps, walkthroughProgressSteps } from '../../../../constants.walkthroughs.js';
import { createCommandLink } from '../../../../system/commands.js';
import { focusOutline } from '../../shared/components/styles/lit/a11y.css.js';
import { boxSizingBase } from '../../shared/components/styles/lit/base.css.js';
import type { SettingsActions } from '../actions.js';
import type { SettingsState } from '../state.js';
import { settingsStateContext } from '../state.js';
import '../../shared/components/code-icon.js';

// Register the ring's sweep angle as a typed custom property so its fill can transition.
// @property inside a constructable/shadow stylesheet doesn't reliably register in Chromium —
// it silently fails to register when the component first mounts via navigation rather than at
// initial document load, so `var(--setup-ring-angle)` resolves to the guaranteed-invalid value
// and the conic-gradient collapses to `none`. The JS API registers it document-globally instead.
if (typeof CSS !== 'undefined' && 'registerProperty' in CSS) {
	try {
		CSS.registerProperty({
			name: '--setup-ring-angle',
			syntax: '<angle>',
			inherits: false,
			initialValue: '0deg',
		});
	} catch {
		/* already registered */
	}
}

declare global {
	interface HTMLElementTagNameMap {
		['gl-settings-setup']: GlSettingsSetup;
	}
}

/** One resolved launchpad step, computed from the live shared-service signals each render. */
interface SetupStep {
	key: string;
	/** Rail/icon accent — the purple→blue brand sweep position for this step. */
	accent: string;
	icon: string;
	title: string;
	why: string;
	state: 'todo' | 'progress' | 'done';
	status: string;
	action: string;
	actionVariant: 'primary' | 'secondary' | 'quiet';
	/** 0–1 fill for the in-progress bar (walkthrough steps only). */
	progress?: number;
	/** Setup steps navigate in-app to this category id. */
	nav?: string;
	/** Walkthrough steps run this command link. */
	href?: string;
}

/**
 * The Get Started launchpad — a brand hero (mark, dynamic copy, n/total progress ring) over a
 * fixed six-step list: four setup steps (sign-in, integrations, AI, agents) that navigate in-app
 * to the owning category, and two walkthrough steps that launch the GitLens / Commit Graph
 * walkthroughs.
 *
 * State comes from the shared subscription/integrations/AI/walkthrough RPC signals; rows render
 * immediately (navigation never needs data) and fill in their live status as each signal resolves.
 */
@customElement('gl-settings-setup')
export class GlSettingsSetup extends SignalWatcher(LitElement) {
	static override styles = [
		boxSizingBase,
		css`
			:host {
				display: block;
				/* So the rows' action-wrap query measures the pane, not the viewport */
				container-type: inline-size;
			}

			.hero {
				display: flex;
				gap: var(--gl-space-12);
				align-items: center;
				padding: 2.2rem 2.6rem 2rem;
				/* The one place a brand gradient appears in the settings chrome; decorative, drops out under forced-colors */
				background: radial-gradient(
					120% 160% at 12% -40%,
					color-mix(in srgb, var(--gl-brand-purple) 38%, transparent) 0%,
					color-mix(in srgb, var(--gl-brand-blue) 10%, transparent) 45%,
					transparent 78%
				);
				border-block-end: var(--gl-border-width) solid var(--vscode-widget-border, var(--color-foreground--25));
			}

			.hero--started {
				background: radial-gradient(
					120% 160% at 12% -40%,
					color-mix(in srgb, var(--gl-brand-purple) 30%, transparent) 0%,
					color-mix(in srgb, var(--gl-brand-blue) 8%, transparent) 45%,
					transparent 78%
				);
			}

			.hero__mark {
				display: grid;
				flex: none;
				place-items: center;
				width: 3.6rem;
				height: 3.6rem;
				color: #fff;
				background: var(--gl-gradient-brand);
				border-radius: var(--gl-radius-lg);
			}

			.hero__mark code-icon {
				font-size: 1.8rem;
			}

			.hero__text {
				flex: 1;
				min-width: 0;
			}

			.hero__title {
				margin: 0;
				font-size: 1.7rem;
				font-weight: 600;
				color: var(--color-foreground);
			}

			.hero__subtitle {
				margin: var(--gl-space-2) 0 0;
				font-size: 1.2rem;
				line-height: 1.5;
				color: var(--color-foreground--75);
			}

			.hero__ring {
				position: relative;
				display: grid;
				flex: none;
				place-items: center;
				width: 5.2rem;
				height: 5.2rem;
				background: conic-gradient(
					from 0deg,
					var(--gl-brand-purple) 0deg,
					var(--gl-brand-blue) var(--setup-ring-angle, 0deg),
					color-mix(in srgb, var(--color-foreground) 12%, transparent) var(--setup-ring-angle, 0deg)
				);
				border-radius: 50%;
				transition: --setup-ring-angle var(--gl-duration-slow) var(--gl-ease-out);
			}

			.hero__ring::before {
				position: absolute;
				inset: 0.5rem;
				content: '';
				background: var(--color-background);
				border-radius: 50%;
			}

			.hero__ring-count {
				position: relative;
				font-family: var(--vscode-editor-font-family);
				font-size: 1.2rem;
				font-weight: 600;
				color: var(--color-foreground--65);
			}

			.hero--started .hero__ring-count {
				color: var(--color-foreground);
			}

			/* Ring fill by completed-step count — set via static CSS, not a styleMap inline style:
			   styleMap-set custom properties don't apply when this component mounts via in-app
			   navigation (only on initial page load), which left the conic ring greyed until reload.
			   Keep the count of rules in sync with the number of steps rendered. */
			.hero__ring--0 {
				--setup-ring-angle: 0deg;
			}

			.hero__ring--1 {
				--setup-ring-angle: 60deg;
			}

			.hero__ring--2 {
				--setup-ring-angle: 120deg;
			}

			.hero__ring--3 {
				--setup-ring-angle: 180deg;
			}

			.hero__ring--4 {
				--setup-ring-angle: 240deg;
			}

			.hero__ring--5 {
				--setup-ring-angle: 300deg;
			}

			.hero__ring--6 {
				--setup-ring-angle: 360deg;
			}

			.steps {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-8);
				max-inline-size: 64rem;
				padding: 1.8rem 2.6rem 2.4rem;
				margin: 0;
				list-style: none;
			}

			.step {
				display: flex;
				gap: 1.1rem;
				align-items: center;
				width: 100%;
				padding: 1.1rem 1.2rem;
				font: inherit;
				color: var(--color-foreground);
				text-align: start;
				text-decoration: none;
				appearance: none;
				cursor: pointer;
				background: transparent;
				border: var(--gl-border-width) solid var(--vscode-widget-border, var(--color-foreground--25));
				border-inline-start: 2px solid var(--step-accent, var(--color-foreground--25));
				border-radius: var(--gl-radius-md);
			}

			.step:hover {
				text-decoration: none;
				background: var(--vscode-list-hoverBackground);
			}

			.step:focus-visible {
				${focusOutline}
			}

			.step--done {
				background: color-mix(in srgb, var(--gl-stat-added) 5%, transparent);
				border-inline-start-color: var(--gl-stat-added);
			}

			/* Per-step purple→blue rail/icon accent, by position — static CSS for the same
			   navigation-remount reason as the ring above. */
			.steps > li:nth-child(1) .step {
				--step-accent: color-mix(in srgb, var(--gl-brand-purple), var(--gl-brand-blue) 0%);
			}

			.steps > li:nth-child(2) .step {
				--step-accent: color-mix(in srgb, var(--gl-brand-purple), var(--gl-brand-blue) 20%);
			}

			.steps > li:nth-child(3) .step {
				--step-accent: color-mix(in srgb, var(--gl-brand-purple), var(--gl-brand-blue) 40%);
			}

			.steps > li:nth-child(4) .step {
				--step-accent: color-mix(in srgb, var(--gl-brand-purple), var(--gl-brand-blue) 60%);
			}

			.steps > li:nth-child(5) .step {
				--step-accent: color-mix(in srgb, var(--gl-brand-purple), var(--gl-brand-blue) 80%);
			}

			.steps > li:nth-child(6) .step {
				--step-accent: color-mix(in srgb, var(--gl-brand-purple), var(--gl-brand-blue) 100%);
			}

			.step__icon {
				flex: none;
				font-size: 1.6rem;
				color: var(--step-accent, var(--color-foreground--65));
			}

			.step--done .step__icon {
				color: var(--gl-stat-added);
			}

			.step__body {
				display: flex;
				flex: 1;
				flex-direction: column;
				min-width: 0;
			}

			.step__title {
				font-size: 1.25rem;
				font-weight: 600;
			}

			.step--done .step__title {
				color: var(--color-foreground--75);
			}

			.step__why {
				margin-block-start: var(--gl-space-2);
				font-size: 1.1rem;
				line-height: 1.45;
				color: var(--color-foreground--65);
			}

			.step__status {
				display: flex;
				gap: 0.6rem;
				align-items: center;
				margin-block-start: var(--gl-space-4);
				font-size: 1.05rem;
				color: var(--color-foreground--50);
			}

			.step__dot {
				flex: none;
				width: 0.5rem;
				height: 0.5rem;
				background: color-mix(in srgb, var(--color-foreground) 35%, transparent);
				border-radius: 50%;
			}

			.step--progress .step__dot {
				background: var(--vscode-progressBar-background, var(--gl-brand-blue));
			}

			.step--done .step__dot {
				background: var(--gl-stat-added);
			}

			.step__progress {
				display: block;
				height: 0.3rem;
				margin-block-start: 0.7rem;
				overflow: hidden;
				background: color-mix(in srgb, var(--color-foreground) 12%, transparent);
				border-radius: var(--gl-radius-xs);
			}

			.step__progress-fill {
				display: block;
				height: 100%;
				background: var(--vscode-progressBar-background, var(--gl-brand-blue));
			}

			.step__action {
				flex: none;
				padding: 0.4rem 1rem;
				font-size: 1.25rem;
				border: var(--gl-border-width) solid transparent;
				border-radius: var(--gl-radius-sm);
			}

			.step__action--primary {
				color: var(--vscode-button-foreground);
				background: var(--vscode-button-background);
			}

			.step__action--secondary {
				color: var(--vscode-button-secondaryForeground, var(--color-foreground));
				background: var(--vscode-button-secondaryBackground);
			}

			.step__action--quiet {
				color: var(--color-foreground--75);
				background: transparent;
				border-color: var(--vscode-widget-border, var(--color-foreground--25));
			}

			/* Below the ~520px pane the action drops under the text block; the three lines are kept */
			@container (max-width: 520px) {
				.step {
					flex-wrap: wrap;
				}

				.step__action {
					margin-inline-start: 2.7rem;
				}
			}

			@media (prefers-reduced-motion: reduce) {
				.hero__ring {
					transition: none;
				}
			}
		`,
	];

	@consume({ context: settingsStateContext })
	private _state!: SettingsState;

	@property({ attribute: false })
	actions?: SettingsActions;

	override render(): unknown {
		const steps = [
			this.signInStep(0),
			this.integrationsStep(1),
			this.aiStep(2),
			this.agentsStep(3),
			this.walkthroughStep(4),
			this.graphWalkthroughStep(5),
		];
		const done = steps.filter(s => s.state === 'done').length;
		const total = steps.length;

		return html`${this.renderHero(done, total)}
			<ul class="steps">
				${steps.map(step => this.renderStep(step))}
			</ul>`;
	}

	private renderHero(done: number, total: number) {
		const { title, subtitle } = this.heroCopy(done, total);

		// The ring fill (angle) is applied by the `.hero__ring--<done>` static class, not an inline
		// style — see the CSS note; styleMap custom properties don't survive an in-app navigation mount.
		return html`<div class="hero ${done > 0 ? 'hero--started' : ''}">
			<div class="hero__mark"><code-icon icon="checklist" aria-hidden="true"></code-icon></div>
			<div class="hero__text">
				<h2 class="hero__title">${title}</h2>
				<p class="hero__subtitle">${subtitle}</p>
			</div>
			<div class="hero__ring hero__ring--${done}" role="img" aria-label="${done} of ${total} steps complete">
				<span class="hero__ring-count" aria-hidden="true">${done}/${total}</span>
			</div>
		</div>`;
	}

	private renderStep(step: SetupStep) {
		const inner = html`<code-icon
				class="step__icon"
				icon=${step.state === 'done' ? 'check' : step.icon}
				aria-hidden="true"
			></code-icon>
			<span class="step__body">
				<span class="step__title">${step.title}</span>
				<span class="step__why">${step.why}</span>
				<span class="step__status"><span class="step__dot"></span>${step.status}</span>
				${
					step.progress != null
						? html`<span class="step__progress"
								><span
									class="step__progress-fill"
									style=${styleMap({ inlineSize: `${Math.round(step.progress * 100)}%` })}
								></span
							></span>`
						: nothing
				}
			</span>
			<span class="step__action step__action--${step.actionVariant}" aria-hidden="true">${step.action}</span>`;

		// The rail/icon accent comes from the `.steps > li:nth-child(n) .step` static CSS, not an
		// inline style — styleMap custom properties don't survive an in-app navigation mount.
		const cls = `step step--${step.state}`;
		const label = `${step.title}. ${step.status}`;

		if (step.href != null) {
			return html`<li>
				<a class=${cls} href=${step.href} aria-label=${label}>${inner}</a>
			</li>`;
		}

		return html`<li>
			<button
				type="button"
				class=${cls}
				aria-label=${label}
				@click=${() => {
					if (step.nav != null) {
						this.actions?.selectCategory(step.nav);
					}
				}}
			>
				${inner}
			</button>
		</li>`;
	}

	// ── Step builders ──

	private signInStep(index: number): SetupStep {
		const sub = this._state.subscription.get();
		const account = sub?.account;
		const done = account != null;

		return {
			key: 'account',
			accent: this.accent(index),
			icon: account != null ? 'account' : 'sign-in',
			title: 'Sign in to unlock GitLens Pro',
			why: 'Sign in or create a free GitKraken account to access AI workflows, integrations, and the full Commit Graph. Your account carries your setup to every device you code on.',
			state: done ? 'done' : 'todo',
			status: done ? `Signed in${account.name ? ` as ${account.name}` : ''}` : 'Not signed in',
			action: done ? 'Manage' : 'Sign in',
			actionVariant: done ? 'quiet' : 'primary',
			// The Account section carries the real sign-in / create-account / manage CTAs
			nav: 'account',
		};
	}

	private integrationsStep(index: number): SetupStep {
		const integrations = this._state.cloudIntegrations.get();
		const connected = integrations?.filter(i => i.connected) ?? [];
		const done = connected.length > 0;

		return {
			key: 'integrations',
			accent: this.accent(index),
			icon: 'plug',
			title: 'Bring your PRs and Issues into the IDE',
			why: 'Link GitHub, GitLab, Bitbucket, Azure DevOps, or Jira so branches carry their PRs and issues, and Launchpad can tell you what needs you next.',
			state: done ? 'done' : 'todo',
			status: done ? `Connected · ${this.connectedSummary(connected.map(i => i.name))}` : 'Not connected',
			action: done ? 'Connect More' : 'Connect',
			actionVariant: done ? 'quiet' : 'primary',
			nav: 'integrations',
		};
	}

	private aiStep(index: number): SetupStep {
		const ai = this._state.aiState.get();
		const model = this._state.aiModel.get();
		const base = {
			key: 'ai',
			accent: this.accent(index),
			title: 'Let AI review, compose, and resolve for you',
			why: 'Auto-compose a sprawling working tree into logical commits, get a review pass before you push, resolve conflicts, and explain unfamiliar history - with whatever model you pick.',
			nav: 'ai',
		} as const;

		if (ai?.orgEnabled === false) {
			return {
				...base,
				icon: 'sparkle',
				state: 'todo',
				status: 'Disabled by your GitKraken admin',
				action: 'Open AI',
				actionVariant: 'primary',
			};
		}

		const done = model != null;
		return {
			...base,
			icon: done ? 'sparkle-filled' : 'sparkle',
			state: done ? 'done' : 'todo',
			status: done ? `${model.provider.name} · ${model.name}` : 'No provider or model selected',
			action: done ? 'Change Model' : 'Choose Model',
			actionVariant: done ? 'quiet' : 'primary',
		};
	}

	private agentsStep(index: number): SetupStep {
		const ai = this._state.aiState.get();
		const mcp = ai?.mcp;
		const mcpActive = mcp?.settingEnabled === true && mcp?.installed === true;
		// Hooks only count when a hook-supporting agent is present; otherwise there's nothing to install
		const claude = ai?.hooks.claude;
		const hooksApplicable = claude?.supported === true && claude?.detected === true;
		const hooksDone = !hooksApplicable || claude?.installed === true;
		const done = mcpActive && hooksDone;

		let status: string;
		if (done) {
			status = hooksApplicable ? 'MCP connected · Claude Code hooks installed' : 'MCP connected';
		} else {
			status = 'MCP and hooks not set up';
		}

		return {
			key: 'agents',
			accent: this.accent(index),
			icon: 'robot',
			title: 'Give agents Git context, and watch them work',
			why: 'MCP gives agents your history, branches, PRs, and issue context; hooks report their sessions back, so you can view and manage agents directly in the Graph.',
			state: done ? 'done' : 'todo',
			status: status,
			action: done ? 'Manage Agents' : 'Set up',
			actionVariant: done ? 'quiet' : 'primary',
			nav: 'agents',
		};
	}

	private walkthroughStep(index: number): SetupStep {
		return this.buildWalkthroughStep(
			index,
			'walkthrough',
			'gl-gitlens',
			'Take a tour: blame, hovers, and more',
			'Walk through deep authorship insights, getting line-level authorship as you scan code',
			this._state.walkthrough.get()?.main,
			walkthroughProgressSteps,
			createCommandLink('gitlens.showWelcomeView', { mode: 'main' }),
		);
	}

	private graphWalkthroughStep(index: number): SetupStep {
		return this.buildWalkthroughStep(
			index,
			'graph-walkthrough',
			'gl-graph',
			'Run your whole Git workflow from the Graph',
			'Six steps to ship a change end-to-end: monitor your agents, manage parallel work, review changes with AI, compose commits, compare refs, and know your next steps.',
			this._state.walkthrough.get()?.graph,
			graphWalkthroughProgressSteps,
			createCommandLink('gitlens.showWelcomeView', { mode: 'graph' }),
		);
	}

	private buildWalkthroughStep(
		index: number,
		key: string,
		icon: string,
		title: string,
		why: string,
		progress: WalkthroughProgress | GraphWalkthroughProgress | undefined,
		labels: Record<string, string>,
		href: string,
	): SetupStep {
		const base = { key: key, accent: this.accent(index), icon: icon, title: title, why: why, href: href } as const;

		if (progress == null) {
			return { ...base, state: 'todo', status: 'Not started', action: 'Start', actionVariant: 'secondary' };
		}

		const { doneCount, allCount } = progress;
		if (allCount > 0 && doneCount >= allCount) {
			return {
				...base,
				state: 'done',
				status: 'Completed',
				action: 'Replay',
				actionVariant: 'quiet',
			};
		}

		if (doneCount > 0) {
			const next = this.nextStepLabel(progress.state, labels);
			return {
				...base,
				state: 'progress',
				status: `In progress · ${doneCount} of ${allCount} steps${next != null ? ` · next up, ${next}` : ''}`,
				action: 'Continue',
				actionVariant: 'primary',
				progress: allCount > 0 ? doneCount / allCount : 0,
			};
		}

		return {
			...base,
			state: 'todo',
			status: `Not started · 0 of ${allCount} steps`,
			action: 'Start',
			actionVariant: 'secondary',
		};
	}

	// ── Helpers ──

	/** Purple→blue brand sweep position for a step (index 0 = purple … index 5 = blue, across the six steps). */
	private accent(index: number): string {
		return `color-mix(in srgb, var(--gl-brand-purple), var(--gl-brand-blue) ${index * 20}%)`;
	}

	private connectedSummary(names: string[]): string {
		if (names.length <= 3) return names.join(', ');
		return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
	}

	/** Label of the first not-yet-done step, in the walkthrough's own step order. */
	private nextStepLabel(state: Record<string, boolean>, labels: Record<string, string>): string | undefined {
		for (const [key, done] of Object.entries(state)) {
			if (!done) return labels[key];
		}
		return undefined;
	}

	private heroCopy(done: number, total: number): { title: string; subtitle: string } {
		if (done === 0) {
			return {
				title: 'Set up GitLens',
				subtitle:
					'A few steps unlock your account, PR context on your branches, AI for commits and reviews, agent access, and the guided tours.',
			};
		}
		if (done >= total) {
			return {
				title: "You're all set",
				subtitle: 'GitLens is fully set up. Revisit any step below to make changes.',
			};
		}

		const remaining = total - done;
		return {
			title: 'Almost there',
			subtitle: `${done} of ${total} done — ${remaining} ${remaining === 1 ? 'step' : 'steps'} left to finish setting up GitLens.`,
		};
	}
}
