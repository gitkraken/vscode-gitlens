import { consume } from '@lit/context';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { GlCommands } from '../../../../constants.commands.js';
import { ExecuteCommand } from '../../../protocol.js';
import type { State } from '../../../welcome/protocol.js';
import { scrollableBase } from '../../shared/components/styles/lit/base.css.js';
import { ipcContext } from '../../shared/contexts/ipc.js';
import type { TelemetryContext } from '../../shared/contexts/telemetry.js';
import { telemetryContext } from '../../shared/contexts/telemetry.js';
import { stateContext } from '../../welcome/context.js';
import { welcomeStyles } from './welcome-page.css.js';
import '../../shared/components/gitlens-logo.js';
import '../../shared/components/button.js';
import '../../shared/components/code-icon.js';
import './welcome-parts.js';

declare global {
	interface HTMLElementTagNameMap {
		'gl-welcome-page': GlWelcomePage;
	}
}

const helpBlameUrl =
	'https://help.gitkraken.com/gitlens/gitlens-features/?utm_source=gitlens-extension&utm_medium=in-app-links#current-line-blame';
const helpRevisionNavigationUrl =
	'https://help.gitkraken.com/gitlens/gitlens-features/?utm_source=gitlens-extension&utm_medium=in-app-links#revision-navigation';

type TelemetryData = {
	viewedCarouselPages: number;
	proButtonClicked: boolean;
};

@customElement('gl-welcome-page')
export class GlWelcomePage extends LitElement {
	static override styles = [scrollableBase, welcomeStyles];

	private telemetryData: TelemetryData = {
		viewedCarouselPages: 0,
		proButtonClicked: false,
	};

	@property({ type: Boolean })
	closeable = false;

	@property({ type: String })
	webroot?: string;

	@property({ type: Boolean })
	private isLightTheme = false;

	@consume<State>({ context: stateContext, subscribe: true })
	@state()
	private _state!: State;

	@consume({ context: ipcContext })
	_ipc!: typeof ipcContext.__context__;

	@consume({ context: telemetryContext as { __context__: TelemetryContext } })
	_telemetry!: TelemetryContext;

	override connectedCallback(): void {
		super.connectedCallback?.();
		this._telemetry.sendEvent({
			name: 'welcome/action',
			data: {
				name: 'shown',
			},
			source: { source: 'welcome' },
		});
	}

	private onStartTrial() {
		this.telemetryData.proButtonClicked = true;
		const command: GlCommands = 'gitlens.plus.signUp';
		this._telemetry.sendEvent({
			name: 'welcome/action',
			data: {
				name: 'plus/sign-up',
				viewedCarouselPages: this.telemetryData.viewedCarouselPages,
			},
			source: { source: 'welcome' },
		});
		this._ipc.sendCommand(ExecuteCommand, { command: command, args: [{ source: 'welcome' }] });
	}

	private onClose() {
		this._telemetry.sendEvent({
			name: 'welcome/action',
			data: {
				name: 'dismiss',
				viewedCarouselPages: this.telemetryData.viewedCarouselPages,
				proButtonClicked: this.telemetryData.proButtonClicked,
			},
			source: { source: 'welcome', detail: 'dismiss-in-body' },
		});
		this.dispatchEvent(new CustomEvent('close'));
	}

	private onFeatureAppeared() {
		this.telemetryData.viewedCarouselPages++;
	}

	getTelemetryData(): TelemetryData {
		return { ...this.telemetryData };
	}

	override render(): unknown {
		const themeSuffix = this.isLightTheme ? 'light' : 'dark';
		return html`
			<div part="page" class="welcome scrollable">
				<div class="section plain header">
					<div class="logo"><gitlens-logo></gitlens-logo></div>
					<h1>GitLens is now installed in ${this._state.hostAppName}</h1>
					<p>
						Understand every line of code — instantly. GitLens reveals authorship, activity, and history
						inside the editor
					</p>
				</div>
				<div class="section plain">
					<h2>With <span class="accent">PRO</span> subscription you get more</h2>
				</div>

				<div class="section">
					<gl-feature-carousel @gl-feature-appeared=${this.onFeatureAppeared}>
						<gl-feature-card class="card">
							<img
								slot="image"
								src="${this.webroot ?? ''}/media/feature-graph-${themeSuffix}.webp"
								alt="Commit Graph"
							/>
							<h1>Interact with Your Repository History</h1>
							<p>
								Use the Commit Graph to visualize branches, search for changes, and navigate complex
								history.
							</p>
							<p><a href="command:gitlens.showGraph">View your Commit Graph</a></p>
						</gl-feature-card>
						<gl-feature-card class="card">
							<img
								slot="image"
								src="${this.webroot ?? ''}/media/feature-commit-composer-${themeSuffix}.webp"
								alt="Commit Composer"
							/>
							<h1>Commit Smarter, Not Harder</h1>
							<p>
								Focus on building, then let AI generate a sequence of commits with descriptive
								summaries.
							</p>
							<p><a href="command:gitlens.composeCommits">Open Commit Composer</a></p>
						</gl-feature-card>
						<gl-feature-card class="card">
							<img
								slot="image"
								src="${this.webroot ?? ''}/media/feature-timeline-${themeSuffix}.webp"
								alt="Visual File History"
							/>
							<h1>Visualize Your Code's Evolution</h1>
							<p>
								See how a file has changed over time when changes were made, the size of those changes,
								and who made them.
							</p>
							<p><a href="command:gitlens.showTimelineView">Open Visual File History</a></p>
						</gl-feature-card>
						<gl-feature-card class="card">
							<img
								slot="image"
								src="${this.webroot ?? ''}/media/feature-launchpad-${themeSuffix}.webp"
								alt="Launchpad"
							/>
							<h1>Streamline Pull Request Management</h1>
							<p>Launchpad integrates PR workflows directly into your editor.</p>
							<p><a href="command:gitlens.showLaunchpad">View my PRs in Launchpad</a></p>
						</gl-feature-card>
					</gl-feature-carousel>
				</div>

				<div class="section start-trial">
					<gl-button class="start-trial-button" @click=${() => this.onStartTrial()}
						>Start GitLens Pro Trial</gl-button
					>
					${this.closeable
						? html`<gl-button appearance="secondary" density="tight" @click=${() => this.onClose()}
								>Dismiss Welcome Overlay</gl-button
							>`
						: nothing}
				</div>

				<div class="section plain">
					<h2>You also get these free features</h2>
				</div>

				<div class="section wide">
					<gl-scrollable-features>
						<gl-feature-narrow-card class="card">
							<h1>Blame Annotations & Hovers</h1>
							<p>See who changed what and why with inline blame, hovers, and CodeLens.</p>
							<p>
								<a href="${helpBlameUrl}">Learn more about inline blame</a>
							</p>
						</gl-feature-narrow-card>
						<gl-feature-narrow-card class="card">
							<h1>Autolinks</h1>
							<p>Get links to pull requests and issues right from a commit message</p>
							<p>
								<a href="command:gitlens.showSettingsPage!autolinks">Configure autolinks</a>
							</p>
						</gl-feature-narrow-card>
						<gl-feature-narrow-card class="card">
							<h1>GitLens Inspect</h1>
							<p>Dive deep into the revision history of files, folders, or specific lines.</p>
							<p><a href="command:gitlens.showCommitDetailsView">Open GitLens Inspect</a></p>
						</gl-feature-narrow-card>
						<gl-feature-narrow-card class="card">
							<h1>Revision Navigation</h1>
							<p>Step through the history of a file to trace its evolution over time.</p>
							<p><a href="${helpRevisionNavigationUrl}">Learn about Revision Navigation</a></p>
						</gl-feature-narrow-card>
					</gl-scrollable-features>
				</div>
			</div>
		`;
	}
}
