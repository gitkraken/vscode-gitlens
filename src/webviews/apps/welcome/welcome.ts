/*global*/
import './welcome.scss';
import { html } from 'lit';
import { customElement } from 'lit/decorators.js';
import type { State } from '../../welcome/protocol';
import { GlAppHost } from '../shared/appHost';
import { scrollableBase } from '../shared/components/styles/lit/base.css';
import type { LoggerContext } from '../shared/contexts/logger';
import type { HostIpc } from '../shared/ipc';
import { WelcomeStateProvider } from './stateProvider';
import '../shared/components/gitlens-logo';
import { welcomeStyles } from './welcome.css';

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

	override render(): unknown {
		return html`
			<div class="welcome scrollable">
				<div class="welcome__section welcome__header">
					<gitlens-logo></gitlens-logo>
					<h1>GitLens is now installed in Cursor</h1>
					<p>
						Understand every line of code — instantly. GitLens reveals authorship, activity, and history
						inside the editor
					</p>
				</div>
				<div class="welcome__section">
					<p>With <span class="welcome__accent">PRO</span> subscription you get more</p>
				</div>

				<div>
					<h2>✨ Key Features</h2>
					<ul>
						<li>
							<span>📝</span>
							<strong>Blame Annotations</strong> - See who changed each line and when
						</li>
						<li>
							<span>📊</span>
							<strong>Commit Graph</strong> - Visualize your repository's history
						</li>
						<li>
							<span>🔍</span>
							<strong>File History</strong> - Track changes to any file over time
						</li>
						<li>
							<span>🌿</span>
							<strong>Branch Management</strong> - Easily manage branches and remotes
						</li>
						<li>
							<span>🤖</span>
							<strong>AI Features</strong> - Generate commit messages and explanations
						</li>
					</ul>
				</div>

				<div>
					<h2>🎯 Next Steps</h2>
					<ul>
						<li>
							<span>1.</span>
							Open the <strong>GitLens Home</strong> view in the sidebar to see your active work
						</li>
						<li>
							<span>2.</span>
							Try the <strong>Commit Graph</strong> to visualize your repository
						</li>
						<li>
							<span>3.</span>
							Hover over any line to see <strong>inline blame</strong> information
						</li>
						<li>
							<span>4.</span>
							Explore the <strong>Command Palette</strong> (Cmd/Ctrl+Shift+P) and search for "GitLens"
						</li>
					</ul>
				</div>

				<div>
					<p>GitLens ${this.state?.version ?? ''} is ready to use!</p>
				</div>
			</div>
		`;
	}
}
