/*global*/
import './allowedSigners.scss';
import { html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { CandidateSigner, State } from '../../allowedSigners/protocol.js';
import { BrowseTargetPathRequest, SaveRequest } from '../../allowedSigners/protocol.js';
import { GlAppHost } from '../shared/appHost.js';
import { scrollableBase } from '../shared/components/styles/lit/base.css.js';
import type { LoggerContext } from '../shared/contexts/logger.js';
import type { HostIpc } from '../shared/ipc.js';
import { allowedSignersBaseStyles, allowedSignersStyles } from './allowedSigners.css.js';
import { AllowedSignersStateProvider } from './stateProvider.js';
import './components/signer-row.js';
import '../shared/components/button.js';
import '../shared/components/code-icon.js';

@customElement('gl-allowed-signers-app')
export class GlAllowedSignersApp extends GlAppHost<State> {
	static override styles = [scrollableBase, allowedSignersBaseStyles, allowedSignersStyles];

	@property({ type: String })
	webroot?: string;

	@state()
	private excluded = new Set<string>();

	// Signer ids written to the file this session — treated as "in file" so they move out of the add list after saving.
	@state()
	private added = new Set<string>();

	@state()
	private targetPath = '';

	@state()
	private configScope: 'global' | 'local' = 'global';

	@state()
	private setConfig = true;

	@state()
	private saving = false;

	@state()
	private status?: { type: 'success' | 'error'; message: string };

	protected override createStateProvider(
		bootstrap: string,
		ipc: HostIpc,
		logger: LoggerContext,
	): AllowedSignersStateProvider {
		return new AllowedSignersStateProvider(this, bootstrap, ipc, logger);
	}

	override connectedCallback(): void {
		super.connectedCallback?.();

		this.targetPath = this.state.targetPath;
		this.configScope = this.state.setConfigScope;
	}

	/** Whether a signer is already in the target file (initially, or added during this session). */
	private isInFile(s: CandidateSigner): boolean {
		return s.alreadyPresent || this.added.has(s.id);
	}

	/** Signers not yet in the file — the only ones that can be added. */
	private get newSigners(): CandidateSigner[] {
		return this.state.signers.filter(s => !this.isInFile(s));
	}

	/** New signers that are checked — exactly what a save will write. */
	private get signersToAdd(): CandidateSigner[] {
		return this.newSigners.filter(s => !this.excluded.has(s.id));
	}

	private onPathChange(e: Event) {
		this.targetPath = (e.target as HTMLInputElement).value;
	}

	private onSetConfigChange(e: Event) {
		this.setConfig = (e.target as HTMLInputElement).checked;
	}

	private setScope(scope: 'global' | 'local') {
		this.configScope = scope;
	}

	private onToggleSigner(e: CustomEvent<{ id: string; included: boolean }>) {
		const { id, included } = e.detail;
		const next = new Set(this.excluded);
		if (included) {
			next.delete(id);
		} else {
			next.add(id);
		}
		this.excluded = next;
	}

	private async onBrowse() {
		const result = await this._ipc.sendRequest(BrowseTargetPathRequest, undefined);
		if (result.path) {
			this.targetPath = result.path;
		}
	}

	private async onSave() {
		const adding = this.signersToAdd;
		if (adding.length === 0) return;

		this.saving = true;
		this.status = undefined;

		try {
			const result = await this._ipc.sendRequest(SaveRequest, {
				entries: adding.map(s => ({ email: s.email, keyType: s.keyType, keyData: s.keyData })),
				targetPath: this.targetPath,
				setConfig: this.setConfig,
				scope: this.configScope,
			});

			if (result.written) {
				// These signers are now in the file — move them to the "already in file" group.
				this.added = new Set([...this.added, ...adding.map(s => s.id)]);
				const config = result.configSet ? ' and updated git config' : '';
				this.status = {
					type: 'success',
					message: `Added ${result.added} ${result.added === 1 ? 'signer' : 'signers'}${config}.`,
				};
			} else {
				this.status = { type: 'error', message: result.error ?? 'Failed to write the allowed_signers file.' };
			}
		} catch (ex) {
			this.status = { type: 'error', message: ex instanceof Error ? ex.message : String(ex) };
		} finally {
			this.saving = false;
		}
	}

	override render(): unknown {
		const { loading, repoName } = this.state;

		return html`
			<div class="container scrollable">
				<header>
					<h1>SSH Allowed Signers</h1>
					<p>
						Build an <code>allowed_signers</code> file so Git can verify SSH-signed
						commits${repoName ? html` in <strong>${repoName}</strong>` : nothing}. Verified signers appear
						as “Signed &amp; Verified” in GitLens.
					</p>
				</header>

				${loading ? this.renderLoading() : this.renderContent()}
			</div>
		`;
	}

	private renderLoading(): unknown {
		const p = this.state.progress;
		const detail =
			p?.total != null
				? `${p.current ?? 0} / ${p.total} commits scanned${
						p.found != null ? ` · ${p.found} signer${p.found === 1 ? '' : 's'} found` : ''
					}`
				: undefined;

		return html`
			<div class="loading" aria-busy="true">
				<code-icon class="loading__spinner" icon="loading" modifier="spin"></code-icon>
				<p class="loading__message">${p?.message ?? 'Loading…'}</p>
				${detail ? html`<p class="loading__detail">${detail}</p>` : nothing}
			</div>
		`;
	}

	private renderContent(): unknown {
		const { signers, hasNodeHost, integrationConnected, verifying, error } = this.state;
		const newSigners = this.newSigners;
		const inFileSigners = signers.filter(s => this.isInFile(s));
		const addCount = this.signersToAdd.length;

		return html`
			${error
				? html`<div class="notice notice--error" role="alert">
						<code-icon icon="error"></code-icon>
						<span>Couldn't finish discovering signers: ${error}</span>
					</div>`
				: nothing}
			${verifying
				? html`<div class="verifying" aria-busy="true">
						<code-icon icon="loading" modifier="spin"></code-icon>
						<span>Checking your connected integration for verified keys…</span>
					</div>`
				: nothing}
			${!hasNodeHost
				? html`<div class="notice">
						<code-icon icon="warning"></code-icon>
						<span>Writing an allowed_signers file isn't supported in this environment.</span>
					</div>`
				: nothing}
			${signers.length === 0
				? html`<div class="empty">
						No SSH signers were found.
						${integrationConnected
							? html`No SSH-signed commits were found in this repository.`
							: html`Connect a GitHub or GitLab integration, or sign commits with SSH, to discover
								signers.`}
					</div>`
				: html`<div class="list" @gl-toggle-signer=${this.onToggleSigner}>
						${newSigners.map(
							s =>
								html`<gl-signer-row
									.signer=${s}
									?included=${!this.excluded.has(s.id)}
								></gl-signer-row>`,
						)}
						${inFileSigners.length
							? html`<div class="list__group">Already in your allowed_signers</div>
									${inFileSigners.map(
										s => html`<gl-signer-row .signer=${s} ?present=${true}></gl-signer-row>`,
									)}`
							: nothing}
					</div>`}

			<div class="toolbar">
				<div class="field">
					<label for="path">File location</label>
					<div class="path-row">
						<input id="path" type="text" .value=${this.targetPath} @change=${this.onPathChange} />
						<gl-button appearance="secondary" ?disabled=${!hasNodeHost} @click=${this.onBrowse}>
							Browse…
						</gl-button>
					</div>
				</div>

				<label>
					<input type="checkbox" .checked=${this.setConfig} @change=${this.onSetConfigChange} />
					Point <code>gpg.ssh.allowedSignersFile</code> at this file
				</label>

				${this.setConfig
					? html`<div class="options">
							<label>
								<input
									type="radio"
									name="scope"
									?checked=${this.configScope === 'global'}
									@change=${() => this.setScope('global')}
								/>
								Global (all repositories)
							</label>
							<label>
								<input
									type="radio"
									name="scope"
									?checked=${this.configScope === 'local'}
									@change=${() => this.setScope('local')}
								/>
								This repository only
							</label>
						</div>`
					: nothing}
			</div>

			<div class="actions">
				<gl-button
					?disabled=${this.saving || !hasNodeHost || !this.targetPath || addCount === 0}
					@click=${this.onSave}
				>
					${this.saving ? 'Saving…' : `Add ${addCount} signer${addCount === 1 ? '' : 's'}`}
				</gl-button>
				${this.renderActionHint(newSigners.length, addCount, hasNodeHost)}
			</div>
		`;
	}

	private renderActionHint(newCount: number, addCount: number, hasNodeHost: boolean): unknown {
		if (this.status != null) {
			return html`<span class="status status--${this.status.type}">${this.status.message}</span>`;
		}
		// Nothing discovered at all — the empty state already explains; a "they're all already in your file" hint here
		// would contradict it.
		if (this.saving || !hasNodeHost || addCount > 0 || this.state.signers.length === 0) return nothing;

		return html`<span class="status"
			>${newCount === 0
				? 'All discovered signers are already in your allowed_signers.'
				: 'Select signers to add.'}</span
		>`;
	}
}
