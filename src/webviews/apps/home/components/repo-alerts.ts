import { consume } from '@lit/context';
import { css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { State } from '../../../home/protocol';
import { GlElement } from '../../shared/components/element';
import { linkBase } from '../../shared/components/styles/lit/base.css';
import { stateContext } from '../context';
import { alertStyles, homeBaseStyles } from '../home.css';
import '../../shared/components/button';

@customElement('gl-repo-alerts')
export class GlRepoAlerts extends GlElement {
	static override styles = [
		linkBase,
		homeBaseStyles,
		alertStyles,
		css`
			.alert {
				margin-bottom: 0;
			}

			.centered {
				text-align: center;
			}

			.one-line {
				white-space: nowrap;
			}

			gl-button.is-basic {
				max-width: 300px;
				width: 100%;
			}
			gl-button.is-basic + gl-button.is-basic {
				margin-top: 1rem;
			}
		`,
	];

	@property({ type: Boolean, reflect: true, attribute: 'has-alerts' })
	get hasAlerts() {
		return this.alertVisibility.header !== true ? undefined : true;
	}

	@consume<State>({ context: stateContext, subscribe: true })
	@state()
	private _state!: State;

	get alertVisibility() {
		const sections = {
			header: false,
			untrusted: false,
			noRepo: false,
			unsafeRepo: false,
		};
		if (this._state == null || this._state.discovering) {
			return sections;
		}

		if (!this._state.repositories.trusted) {
			sections.header = true;
			sections.untrusted = true;
		} else if (this._state.repositories.openCount === 0) {
			sections.header = true;
			sections.noRepo = true;
		} else if (this._state.repositories.hasUnsafe) {
			sections.header = true;
			sections.unsafeRepo = true;
		}

		return sections;
	}

	override render() {
		if (this._state == null || !this.alertVisibility.header) {
			return;
		}

		return html`
			${when(
				this.alertVisibility.noRepo,
				() => html`
					<div id="no-repo-alert" class="alert alert--info mb-0">
						<h1 class="alert__title">No repository detected</h1>
						<div class="alert__description">
							<p>
								To use GitLens, open a folder containing a git repository or clone from a URL from the
								Explorer.
							</p>
							<p class="centered">
								<gl-button class="is-basic" href="command:workbench.view.scm"
									>Open a Folder or Repository</gl-button
								>
							</p>
							<p class="mb-0">
								If you have opened a folder with a repository, please let us know by
								<a class="one-line" href="https://github.com/gitkraken/vscode-gitlens/issues/new/choose"
									>creating an Issue</a
								>.
							</p>
						</div>
					</div>
				`,
			)}
			${when(
				this.alertVisibility.unsafeRepo,
				() => html`
					<div id="unsafe-repo-alert" class="alert alert--info mb-0">
						<h1 class="alert__title">Unsafe repository</h1>
						<div class="alert__description">
							<p>
								Unable to open any repositories as Git blocked them as potentially unsafe, due to the
								folder(s) not being owned by the current user.
							</p>
							<p class="centered">
								<gl-button class="is-basic" href="command:workbench.view.scm"
									>Manage in Source Control</gl-button
								>
							</p>
						</div>
					</div>
				`,
			)}
			${when(
				this.alertVisibility.untrusted,
				() => html`
					<div id="untrusted-alert" class="alert alert--info mb-0" aria-hidden="true">
						<h1 class="alert__title">Untrusted workspace</h1>
						<div class="alert__description">
							<p>Unable to open repositories in Restricted Mode.</p>
							<p class="centered">
								<gl-button class="is-basic" href="command:workbench.trust.manage"
									>Manage Workspace Trust</gl-button
								>
							</p>
						</div>
					</div>
				`,
			)}
		`;
	}
}
