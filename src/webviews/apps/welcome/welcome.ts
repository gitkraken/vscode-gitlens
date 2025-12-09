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

const helpBlameUrl =
	'https://www.gitkraken.com/gitlens?utm_source=gitlens-extension&utm_medium=in-app-links#Visual-Repository-Intelligence';
const helpLaunchpadUrl =
	'https://www.gitkraken.com/gitlens?utm_source=gitlens-extension&utm_medium=in-app-links#Visual-Repository-Intelligence';

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
							<h1>Navigate Complex Repository Structures</h1>
							<p>by unlocking the full potential of the interactive Commit Graph.</p>
							<p><a href="command:gitlens.showGraph">Open Commit Graph</a></p>
						</gl-feature-card>
						<gl-feature-card class="card">
							<img
								slot="image"
								src="${this.webroot ?? ''}/media/feature-timeline.webp"
								alt="Visual File History"
							/>
							<h1>Accelereate Code Reviews</h1>
							<p>Visual File History provides context into the most important changes.</p>
							<p><a href="command:gitlens.showTimelineView">Open Visual File History</a></p>
						</gl-feature-card>
						<gl-feature-card class="card">
							<img
								slot="image"
								src="${this.webroot ?? ''}/media/feature-launchpad.webp"
								alt="Launchpad"
							/>
							<h1>Streamline Pull Request Management</h1>
							<p>Launchpad integrates PR workflows directly into your editor.</p>
							<p><a href="command:gitlens.showLaunchpad">Open Launchpad</a></p>
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
								src="${this.webroot ?? ''}/media/feature-icon-compass.webp"
								alt="Git Blame"
							/>
							<h1>Git Blame</h1>
							<p>Understand the context behind every line with inline blame annotations</p>
							<p>
								<a href="${helpBlameUrl}">Learn more</a>
							</p>
						</gl-feature-narrow-card>
						<gl-feature-narrow-card class="card">
							<img slot="image" src="${this.webroot ?? ''}//media/feature-icon-pr.webp" alt="Launchpad" />
							<h1>Launchpad</h1>
							<p>Your personalized command center for managing pull requests and issues</p>
							<p><a href="${helpLaunchpadUrl}">Learn more</a></p>
						</gl-feature-narrow-card>
					</gl-scrollable-features>
				</div>
			</div>
		`;
	}
}
