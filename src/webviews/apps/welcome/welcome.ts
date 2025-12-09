/*global*/
import './welcome.scss';
import { html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { GlCommands } from '../../../constants.commands';
import { ExecuteCommand } from '../../protocol';
import type { State } from '../../welcome/protocol';
import { GlAppHost } from '../shared/appHost';
import { scrollableBase } from '../shared/components/styles/lit/base.css';
import type { LoggerContext } from '../shared/contexts/logger';
import type { HostIpc } from '../shared/ipc';
import { WelcomeStateProvider } from './stateProvider';
import '../shared/components/gitlens-logo';
import { welcomeStyles } from './welcome.css';
import './components/feature-carousel';
import './components/feature-card';
import './components/feature-narrow-card';
import './components/scrollable-features';

@customElement('gl-welcome-app')
export class GlWelcomeApp extends GlAppHost<State> {
	static override styles = [scrollableBase, welcomeStyles];

	protected override createStateProvider(
		bootstrap: string,
		ipc: HostIpc,
		logger: LoggerContext,
	): WelcomeStateProvider {
		return new WelcomeStateProvider(this, bootstrap, ipc, logger);
	}

	@property({ type: String })
	webroot?: string;

	private onStartTrial() {
		const command: GlCommands = 'gitlens.plus.signUp';
		this._telemetry.sendEvent({
			name: 'welcome/action',
			data: {
				type: 'command',
				name: 'plus/sign-up',
				command: command,
			},
			source: { source: 'welcome' },
		});
		this._ipc.sendCommand(ExecuteCommand, { command: command, args: [{ source: 'welcome' }] });
	}

	override render(): unknown {
		return html`
			<div class="welcome scrollable">
				<div class="section plain header">
					<div class="logo"><gitlens-logo></gitlens-logo></div>
					<h1>GitLens is now installed in Cursor</h1>
					<p>
						Understand every line of code — instantly. GitLens reveals authorship, activity, and history
						inside the editor
					</p>
				</div>
				<div class="section plain">
					<h2>With <span class="accent">PRO</span> subscription you get more</h2>
				</div>

				<div class="section">
					<gl-feature-carousel>
						<gl-feature-card class="card">
							<img slot="image" src="${this.webroot ?? ''}/media/feature-graph.webp" alt="Commit Graph" />
							<h1>Commit Graph</h1>
							<p>Visualize your repository's history and interact with commits</p>
							<p><a href="command:gitlens.showGraph">Open Commit Graph</a></p>
						</gl-feature-card>
						<gl-feature-card class="card">
							<img
								slot="image"
								src="${this.webroot ?? ''}/media/feature-timeline.webp"
								alt="Visual File History"
							/>
							<h1>Visual File History</h1>
							<p>Track changes to any file over time</p>
							<p><a href="command:gitlens.showTimelineView">Open Visual File History</a></p>
						</gl-feature-card>
					</gl-feature-carousel>
				</div>

				<div class="section start-trial">
					<gl-button @click=${() => this.onStartTrial()}>Start GitLens Pro Trial</gl-button>
				</div>

				<div class="section plain">
					<h2>You also get these free features</h2>
				</div>

				<div class="section wide">
					<gl-scrollable-features>
						<gl-feature-narrow-card class="card">
							<img
								slot="image"
								src="${this.webroot ?? ''}/media/feature-graph.webp"
								alt="Commit Graph"
								width="100"
								height="100"
							/>
							<h1>Commit Graph</h1>
							<p>Visualize your repository's history and interact with commits</p>
							<p><a href="command:gitlens.showGraph">Open Commit Graph</a></p>
						</gl-feature-narrow-card>
						<gl-feature-narrow-card class="card">
							<img
								slot="image"
								src="${this.webroot ?? ''}/media/feature-timeline.webp"
								alt="Visual File History"
								width="32"
								height="32"
							/>
							<h1>Visual File History</h1>
							<p>Track changes to any file over time</p>
							<p><a href="command:gitlens.showTimelineView">Open Visual File History</a></p>
						</gl-feature-narrow-card>
						<gl-feature-narrow-card class="card">
							<img
								slot="image"
								src="${this.webroot ?? ''}/media/feature-graph.webp"
								alt="Commit Graph"
								width="100"
								height="100"
							/>
							<h1>Commit Graph</h1>
							<p>Visualize your repository's history and interact with commits</p>
							<p><a href="command:gitlens.showGraph">Open Commit Graph</a></p>
						</gl-feature-narrow-card>
						<gl-feature-narrow-card class="card">
							<img
								slot="image"
								src="${this.webroot ?? ''}/media/feature-timeline.webp"
								alt="Visual File History"
								width="32"
								height="32"
							/>
							<h1>Visual File History</h1>
							<p>Track changes to any file over time</p>
							<p><a href="command:gitlens.showTimelineView">Open Visual File History</a></p>
						</gl-feature-narrow-card>
						<gl-feature-narrow-card class="card">
							<img
								slot="image"
								src="${this.webroot ?? ''}/media/feature-graph.webp"
								alt="Commit Graph"
								width="100"
								height="100"
							/>
							<h1>Commit Graph</h1>
							<p>Visualize your repository's history and interact with commits</p>
							<p><a href="command:gitlens.showGraph">Open Commit Graph</a></p>
						</gl-feature-narrow-card>
						<gl-feature-narrow-card class="card">
							<img
								slot="image"
								src="${this.webroot ?? ''}/media/feature-timeline.webp"
								alt="Visual File History"
								width="32"
								height="32"
							/>
							<h1>Visual File History</h1>
							<p>Track changes to any file over time</p>
							<p><a href="command:gitlens.showTimelineView">Open Visual File History</a></p>
						</gl-feature-narrow-card>
					</gl-scrollable-features>
				</div>
			</div>
		`;
	}
}
