/*global*/
import './allowedSigners.scss';
import type { Remote } from '@eamodio/supertalk';
import { html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { scrollableBase } from '@gitlens/components/components/styles/lit/base.css.js';
import { fromBase64ToString } from '@gitlens/utils/base64.js';
import type { CandidateSigner, State } from '../../allowedSigners/protocol.js';
import type { AllowedSignersResultsChangedEvent, AllowedSignersServices } from '../../rpc/allowedSignersService.js';
import { SignalWatcherWebviewApp } from '../shared/appBase.js';
import type { Checkbox } from '../shared/components/checkbox/checkbox.js';
import type { RadioGroup } from '../shared/components/radio/radio-group.js';
import { subscribeAll } from '../shared/events/subscriptions.js';
import { getHost } from '../shared/host/context.js';
import { RpcController } from '../shared/rpc/rpcController.js';
import { SubscribeThenSeed } from '../shared/rpc/subscribeThenSeed.js';
import { allowedSignersBaseStyles, allowedSignersStyles } from './allowedSigners.css.js';
import { createAllowedSignersState } from './state.js';
import type { AllowedSignersState } from './state.js';
import './components/signer-row.js';
import '../shared/components/button.js';
import '../shared/components/checkbox/checkbox.js';
import '@gitlens/components/components/codeIcon.js';
import '../shared/components/radio/radio.js';
import '../shared/components/radio/radio-group.js';

@customElement('gl-allowed-signers-app')
export class GlAllowedSignersApp extends SignalWatcherWebviewApp {
	static override styles = [scrollableBase, allowedSignersBaseStyles, allowedSignersStyles];

	private _host = getHost();

	/** Instance-owned ephemeral state — reseeded from bootstrap on every mount. */
	private _state = createAllowedSignersState();

	@property({ type: String })
	webroot?: string;

	/** Subscribe-then-seed choreography — released at disconnect and rerun per ready against the
	 *  new session (the subscriber closes over this mount's state). */
	private readonly _seed = new SubscribeThenSeed<AllowedSignersServices>();

	/** The resolved view-specific service — set per ready; UI handlers are no-ops before then. */
	private _allowedSigners?: Awaited<Remote<AllowedSignersServices>['allowedSigners']>;

	protected override readonly _rpc = new RpcController<AllowedSignersServices>(this, {
		rpcOptions: {
			webviewId: () => this._webview?.webviewId,
			webviewInstanceId: () => this._webview?.webviewInstanceId,
			endpoint: () => this._host.createEndpoint(),
		},
		onReady: services => this._onRpcReady(services),
	});

	override connectedCallback(): void {
		super.connectedCallback?.();

		const context = this.consumeContext();

		// Seed all state from the bootstrap — fixed for this iframe load. Discovery results ride the
		// bootstrap when the panel is re-shown after being hidden (the host caches them); a fresh open
		// arrives with `loading: true` and the live results stream in over the subscriptions below.
		const metadata = JSON.parse(fromBase64ToString(context)) as State;
		const s = this._state;
		s.loading.set(metadata.loading);
		s.progress.set(metadata.progress);
		s.signers.set(metadata.signers);
		s.verifying.set(metadata.verifying);
		s.error.set(metadata.error);
		s.integrationConnected.set(metadata.integrationConnected);
		s.provider.set(metadata.provider);

		s.repoName.set(metadata.repoName);
		s.hasNodeHost.set(metadata.hasNodeHost);
		s.preselectFingerprint.set(metadata.preselectFingerprint);

		s.targetPath.set(metadata.targetPath);
		s.configScope.set(metadata.setConfigScope);
	}

	override disconnectedCallback(): void {
		// Unsubscribe before resetting state: the retained handle would otherwise re-issue its
		// subscriber — which closes over the reset state — on the next handshake. A fresh
		// subscription is created per ready anyway, so nothing is lost by releasing it here.
		this._seed.reset();
		this._allowedSigners = undefined;

		this._state.resetAll();

		super.disconnectedCallback?.();
	}

	private async _onRpcReady(services: Remote<AllowedSignersServices>): Promise<void> {
		const allowedSigners = await services.allowedSigners;
		this._allowedSigners = allowedSigners;

		this._promos.connect(this._rpc.connection!);

		const s = this._state;

		// Subscribe to events FIRST so changes during discovery aren't missed, then pull the latest
		// snapshot — discovery runs once per controller, so a remounted webview's bootstrap can
		// predate the results; `undefined` simply leaves the bootstrap seed. See `SubscribeThenSeed`'s
		// docs for why a results event landing while the fetch is pending is buffered and replayed
		// after it, so the (possibly older) response can't regress it.
		await this._seed.run({
			connection: this._rpc.connection!,
			subscriber: async remoteServices => {
				const svc = await remoteServices.allowedSigners;

				return subscribeAll([
					() =>
						svc.onProgressChanged(progress => {
							s.progress.set(progress);
						}),
					() =>
						svc.onResultsChanged(results => {
							this._seed.during(() => this.applyResults(s, results));
						}),
				]);
			},
			seed: () => allowedSigners.getResults(),
			applySeed: results => {
				if (results != null) {
					this.applyResults(s, results);
				}
			},
		});
	}

	private applyResults(s: AllowedSignersState, results: AllowedSignersResultsChangedEvent): void {
		s.signers.set(results.signers);
		s.integrationConnected.set(results.integrationConnected);
		s.provider.set(results.provider);
		s.verifying.set(results.verifying);
		s.error.set(results.error);
		s.progress.set(undefined);
		s.loading.set(false);
	}

	/**
	 * Whether a signer is already in the target file. Once the host has checked the current path (`presentKeys`), that
	 * is authoritative; before then, fall back to the `alreadyPresent` flag computed at discovery time.
	 */
	private isInFile(s: CandidateSigner): boolean {
		return this._state.presentKeys.get()?.has(s.id) ?? s.alreadyPresent;
	}

	/**
	 * Whether a signer is pre-checked before the user touches anything: API-verified signers (provenance
	 * `provider`/`both` — a key the git host confirms belongs to the identity, unlike a commit's self-asserted signer),
	 * plus the one signer whose key signed the commit the editor was opened from (`preselectFingerprint`).
	 */
	private defaultIncluded(s: CandidateSigner): boolean {
		if (s.provenance === 'provider' || s.provenance === 'both') return true;

		const fp = this._state.preselectFingerprint.get();
		return fp != null && fp.length > 0 && s.fingerprint === fp;
	}

	/** Whether a signer's checkbox is currently checked (explicit user toggle, else the default). */
	private isIncluded(s: CandidateSigner): boolean {
		return this._state.overrides.get().get(s.id) ?? this.defaultIncluded(s);
	}

	/** Signers not yet in the file — the only ones that can be added. */
	private get newSigners(): CandidateSigner[] {
		return this._state.signers.get().filter(s => !this.isInFile(s));
	}

	/** New signers that are checked — exactly what a save will write. */
	private get signersToAdd(): CandidateSigner[] {
		return this.newSigners.filter(s => this.isIncluded(s));
	}

	private onPathChange(e: Event): void {
		this._state.targetPath.set((e.target as HTMLInputElement).value);
		void this.checkPresence();
	}

	private onSetConfigChange(e: Event): void {
		this._state.setConfig.set((e.target as Checkbox).checked);
	}

	private onScopeChange(e: Event): void {
		this._state.configScope.set((e.target as RadioGroup).value === 'local' ? 'local' : 'global');
	}

	private onToggleSigner(e: CustomEvent<{ id: string; included: boolean }>): void {
		const { id, included } = e.detail;
		const next = new Map(this._state.overrides.get());
		next.set(id, included);
		this._state.overrides.set(next);
	}

	private async onBrowse(): Promise<void> {
		const svc = this._allowedSigners;
		if (svc == null) return;

		const path = await svc.browseTargetPath();
		if (path) {
			this._state.targetPath.set(path);
			void this.checkPresence();
		}
	}

	/** Re-derives which signers are already in the file at the current target path (host reads and parses it). */
	private async checkPresence(): Promise<void> {
		const svc = this._allowedSigners;
		if (svc == null) return;

		const targetPath = this._state.targetPath.get();
		const keys = await svc.checkPresence(targetPath);
		// Ignore a stale response if the path changed again while this request was in flight.
		if (this._state.targetPath.get() !== targetPath) return;

		this._state.presentKeys.set(new Set(keys));
	}

	private async onSave(): Promise<void> {
		const adding = this.signersToAdd;
		if (adding.length === 0) return;

		const svc = this._allowedSigners;
		if (svc == null) return;

		const s = this._state;
		s.saving.set(true);
		s.status.set(undefined);

		try {
			const result = await svc.save({
				entries: adding.map(item => ({ email: item.email, keyType: item.keyType, keyData: item.keyData })),
				targetPath: s.targetPath.get(),
				setConfig: s.setConfig.get(),
				scope: s.configScope.get(),
			});

			if (result.written) {
				// Re-read the file we just wrote so the saved signers move into the "already in file" group.
				await this.checkPresence();
				const config = result.configSet ? ' and updated git config' : '';
				s.status.set({
					type: 'success',
					message: `Added ${result.added} ${result.added === 1 ? 'signer' : 'signers'}${config}.`,
				});
			} else {
				s.status.set({ type: 'error', message: result.error ?? 'Failed to write the allowed_signers file.' });
			}
		} catch (ex) {
			s.status.set({ type: 'error', message: ex instanceof Error ? ex.message : String(ex) });
		} finally {
			s.saving.set(false);
		}
	}

	override render(): unknown {
		const s = this._state;

		return html`
			<div class="container scrollable">
				<header>
					<h1>SSH Allowed Signers</h1>
					<p>
						Build an <code>allowed_signers</code> file so Git can verify SSH-signed
						commits${s.repoName.get() ? html` in <strong>${s.repoName.get()}</strong>` : nothing}. Verified
						signers appear as “Signed &amp; Verified” in GitLens.
					</p>
				</header>

				${s.loading.get() ? this.renderLoading() : this.renderContent()}
			</div>
		`;
	}

	private renderLoading(): unknown {
		const p = this._state.progress.get();
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
		const s = this._state;
		const signers = s.signers.get();
		const hasNodeHost = s.hasNodeHost.get();
		const integrationConnected = s.integrationConnected.get();
		const provider = s.provider.get();
		const verifying = s.verifying.get();
		const error = s.error.get();
		const newSigners = this.newSigners;
		const inFileSigners = signers.filter(signer => this.isInFile(signer));
		const addCount = this.signersToAdd.length;

		return html`
			${
				error
					? html`<div class="notice notice--error" role="alert">
							<code-icon icon="error"></code-icon>
							<span>Couldn't finish discovering signers: ${error}</span>
						</div>`
					: nothing
			}
			${
				verifying
					? html`<div class="verifying" aria-busy="true">
							<code-icon icon="loading" modifier="spin"></code-icon>
							<span>Checking your connected integration for verified keys…</span>
						</div>`
					: nothing
			}
			${
				!hasNodeHost
					? html`<div class="notice">
							<code-icon icon="warning"></code-icon>
							<span>Writing an allowed_signers file isn't supported in this environment.</span>
						</div>`
					: nothing
			}

			<div class="toolbar">
				<div class="field">
					<label for="path">File location</label>
					<div class="path-row">
						<input id="path" type="text" .value=${s.targetPath.get()} @change=${this.onPathChange} />
						<gl-button appearance="secondary" ?disabled=${!hasNodeHost} @click=${this.onBrowse}>
							Browse…
						</gl-button>
					</div>
				</div>

				<gl-checkbox .checked=${s.setConfig.get()} @gl-change-value=${this.onSetConfigChange}>
					Point <code>gpg.ssh.allowedSignersFile</code> at this file
				</gl-checkbox>

				${
					s.setConfig.get()
						? html`<gl-radio-group
								class="options"
								.value=${s.configScope.get()}
								@gl-change-value=${this.onScopeChange}
							>
								<gl-radio value="global">Global (all repositories)</gl-radio>
								<gl-radio value="local">This repository only</gl-radio>
							</gl-radio-group>`
						: nothing
				}
			</div>

			${
				signers.length === 0
					? html`<div class="empty">
							No SSH signers were found.
							${
								integrationConnected
									? html`No SSH-signed commits were found in this repository.`
									: html`Connect a GitHub or GitLab integration, or sign commits with SSH, to discover
										signers.`
							}
						</div>`
					: html`<div class="list" @gl-toggle-signer=${this.onToggleSigner}>
							${newSigners.map(
								signer => html`<gl-signer-row
									.signer=${signer}
									.included=${this.isIncluded(signer)}
									.provider=${provider}
									.integrationConnected=${integrationConnected}
								></gl-signer-row>`,
							)}
							${
								inFileSigners.length
									? html`<div class="list__group">Already in your allowed_signers</div>
											${inFileSigners.map(
												signer => html`<gl-signer-row
													.signer=${signer}
													?present=${true}
													.provider=${provider}
													.integrationConnected=${integrationConnected}
												></gl-signer-row>`,
											)}`
									: nothing
							}
						</div>`
			}

			<div class="actions">
				<gl-button
					?disabled=${s.saving.get() || !hasNodeHost || !s.targetPath.get() || addCount === 0}
					@click=${this.onSave}
				>
					${s.saving.get() ? 'Saving…' : `Add ${addCount} Signer${addCount === 1 ? '' : 's'}`}
				</gl-button>
				${this.renderActionHint(newSigners.length, addCount, hasNodeHost)}
			</div>
		`;
	}

	private renderActionHint(newCount: number, addCount: number, hasNodeHost: boolean): unknown {
		const status = this._state.status.get();
		if (status != null) {
			return html`<span class="status status--${status.type}">${status.message}</span>`;
		}
		// Nothing discovered at all — the empty state already explains; a "they're all already in your file" hint here
		// would contradict it.
		if (this._state.saving.get() || !hasNodeHost || addCount > 0 || this._state.signers.get().length === 0) {
			return nothing;
		}

		return html`<span class="status"
			>${
				newCount === 0
					? 'All discovered signers are already in your allowed_signers.'
					: 'Select signers to add.'
			}</span
		>`;
	}
}
