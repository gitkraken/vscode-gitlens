import './settings.scss';
import type { Remote } from '@eamodio/supertalk';
import { provide } from '@lit/context';
import { html, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { isMac } from '@env/platform.js';
import type { SettingsServices } from '../../settings/settingsService.js';
import { SignalWatcherWebviewApp } from '../shared/appBase.js';
import { setDefaultDateLocales } from '../shared/date.js';
import { getHost } from '../shared/host/context.js';
import { RpcController } from '../shared/rpc/rpcController.js';
import { SettingsActions } from './actions.js';
import { settingsAppStyles } from './settings.css.js';
import type { SettingsState } from './state.js';
import { createSettingsState, settingsStateContext } from './state.js';
import './components/settings-detail.js';
import './components/settings-nav.js';
import '../shared/components/code-icon.js';
import '../shared/components/gl-error-banner.js';
import '../shared/components/icons/icon-cube.js';
import '../shared/components/segmented/segmented.js';
import '../shared/components/skeleton-loader.js';
import '../shared/components/split-panel/split-panel.js';

/** Keeps the nav rail usable but never dominant while dragging the divider */
function navSnap({ pos, size }: { pos: number; size: number }): number {
	if (size <= 0) return pos;

	const px = (pos / 100) * size;
	const clamped = Math.max(170, Math.min(480, px));
	return (clamped / size) * 100;
}

@customElement('gl-settings-app')
export class GlSettingsApp extends SignalWatcherWebviewApp {
	static override styles = [settingsAppStyles];

	@property({ type: String, noAccessor: true })
	private context!: string;

	@query('#search')
	private _search?: HTMLInputElement;

	private _host = getHost();

	/** Instance-owned state — created here with persistence support, passed to actions as a parameter. */
	@provide({ context: settingsStateContext })
	private _state: SettingsState = createSettingsState(this._host.storage);

	private _actions?: SettingsActions;
	private _unsubscribes: (() => void)[] = [];
	private _stopAutoPersist?: () => void;

	private _rpc = new RpcController<SettingsServices>(this, {
		rpcOptions: {
			webviewId: () => this._webview?.webviewId,
			webviewInstanceId: () => this._webview?.webviewInstanceId,
			endpoint: () => this._host.createEndpoint(),
		},
		onReady: services => this._onRpcReady(services),
		onError: error => this._state.error.set(error.message),
	});

	override connectedCallback(): void {
		super.connectedCallback?.();

		const context = this.context;
		this.context = undefined!;
		this.initWebviewContext(context);

		window.addEventListener('keydown', this.handleGlobalKeyDown);
	}

	override disconnectedCallback(): void {
		window.removeEventListener('keydown', this.handleGlobalKeyDown);

		for (const unsubscribe of this._unsubscribes) {
			unsubscribe();
		}
		this._unsubscribes = [];

		this._stopAutoPersist?.();
		this._stopAutoPersist = undefined;

		this._actions?.dispose();
		this._actions = undefined;

		this._state.resetAll();
		this._state.dispose();

		super.disconnectedCallback?.();
	}

	private async _onRpcReady(services: Remote<SettingsServices>): Promise<void> {
		const s = this._state;

		try {
			const [settings, subscription, integrations, ai] = await Promise.all([
				services.settings,
				services.subscription,
				services.integrations,
				services.ai,
			]);

			const actions = new SettingsActions(s, services, settings);
			this._actions = actions;

			this._stopAutoPersist = s.startAutoPersist();

			// Subscribe to events FIRST so changes during the initial fetch aren't missed
			const unsubConfig = await settings.onConfigChanged(snapshot => {
				setDefaultDateLocales(snapshot.config.defaultDateLocale);
				s.config.set(snapshot.config);
				s.customSettings.set(snapshot.customSettings);
			});
			const unsubAnchor = await settings.onAnchorRequested(e => {
				actions.openAnchor(e.anchor);
			});
			// Shared-service events feeding the Cloud Integrations & AI panels (and the Autolinks banner)
			const unsubSubscription = await subscription.onSubscriptionChanged(sub => {
				s.subscription.set(sub);
			});
			const unsubIntegrations = await integrations.onIntegrationsChanged(data => {
				s.cloudIntegrations.set(data.integrations);
			});
			const unsubAiModel = await ai.onModelChanged(model => {
				s.aiModel.set(model);
			});
			const unsubAiState = await ai.onStateChanged(state => {
				s.aiState.set(state);
			});
			this._unsubscribes.push(
				unsubConfig,
				unsubAnchor,
				unsubSubscription,
				unsubIntegrations,
				unsubAiModel,
				unsubAiState,
			);

			const context = await settings.getInitialContext();
			setDefaultDateLocales(context.config.defaultDateLocale);
			s.config.set(context.config);
			s.customSettings.set(context.customSettings);
			s.version.set(context.version);
			s.scopes.set(context.scopes);
			// The persisted scope can outlive its validity (e.g. workspace scope
			// restored with no folder open) — writes must never land in a scope
			// that isn't offered
			if (!context.scopes.some(([scope]) => scope === s.scope.get())) {
				s.scope.set('user');
			}
			if (context.anchor) {
				actions.openAnchor(context.anchor);
			}
			s.loading.set(false);

			// Populate the shared-service signals progressively — the panels show
			// skeletons until each resolves, so none of these gate `loading`
			void actions.loadSharedServices();
		} catch (ex) {
			// Keep the loading gate up — rendering interactive controls over
			// missing config would show (and write) the wrong values
			s.error.set(ex instanceof Error ? ex.message : String(ex));
		}
	}

	private handleGlobalKeyDown = (e: KeyboardEvent): void => {
		// The native find widget is disabled (it can't see into the per-category
		// shadow DOM), so the platform find shortcut routes to the app's own
		// search. Modifier guard mirrors search-box.ts — plain ctrl+F on macOS
		// is cursor-forward inside text inputs and must not be hijacked.
		if (
			e.key.toLowerCase() === 'f' &&
			!e.shiftKey &&
			!e.altKey &&
			((e.metaKey && !e.ctrlKey && isMac) || (e.ctrlKey && !e.metaKey && !isMac))
		) {
			e.preventDefault();
			this._search?.focus();
			this._search?.select();
		}
	};

	private handleSearchInput(e: Event): void {
		this._actions?.setQuery((e.target as HTMLInputElement).value);
	}

	private handleSearchKeyDown(e: KeyboardEvent): void {
		if (e.key === 'Escape' && this._state.query.get()) {
			e.preventDefault();
			this._actions?.setQuery('');
			if (this._search != null) {
				this._search.value = '';
			}
		}
	}

	override render(): unknown {
		const s = this._state;
		const scopes = s.scopes.get();

		return html`<gl-error-banner .error=${s.error}></gl-error-banner>
			<div class="app" aria-busy=${s.loading.get()}>
				<header class="header">
					<div class="header__brand">
						<gl-icon-cube appearance="brand" icon="gl-gitlens" aria-hidden="true"></gl-icon-cube>
						<h1 class="header__title">GitLens Settings</h1>
						${s.version.get()
							? html`<a
									class="header__version"
									href="https://github.com/gitkraken/vscode-gitlens/blob/main/CHANGELOG.md"
									aria-label="GitLens ${s.version.get()} — open the CHANGELOG"
									title="Open the CHANGELOG"
									>v${s.version.get()}</a
								>`
							: nothing}
					</div>
					<div class="header__search">
						<code-icon icon="search" aria-hidden="true"></code-icon>
						<input
							id="search"
							type="search"
							placeholder="Search settings (try a name like gitlens.currentLine.format)"
							aria-label="Search settings"
							spellcheck="false"
							.value=${s.query.get()}
							?disabled=${s.loading.get()}
							@input=${this.handleSearchInput}
							@keydown=${this.handleSearchKeyDown}
						/>
					</div>
					${scopes.length > 1
						? html`<div class="header__scope">
								<span id="scope-label">Save for</span>
								<gl-segmented-control
									label="Save settings for"
									.options=${scopes.map(([value, label]) => ({ value: value, label: label }))}
									.value=${s.scope.get()}
									@gl-change-value=${(e: Event) =>
										this._actions?.setScope(
											((e.target as HTMLElement & { value?: string }).value ?? 'user') as
												| 'user'
												| 'workspace',
										)}
								></gl-segmented-control>
							</div>`
						: nothing}
				</header>
				${s.loading.get()
					? s.error.get() != null
						? html`<div class="body body--error" role="alert">
								<code-icon icon="error" aria-hidden="true"></code-icon>
								<span>
									GitLens Settings couldn’t load — ${s.error.get()}.
									<a href="command:workbench.action.reloadWindow">Reload the window</a> to try again.
								</span>
							</div>`
						: html`<div class="body body--loading">
								<div class="body--loading__nav" aria-hidden="true">
									<skeleton-loader lines="12"></skeleton-loader>
								</div>
								<div class="body--loading__detail" aria-hidden="true">
									<skeleton-loader lines="6"></skeleton-loader>
								</div>
							</div>`
					: html`<gl-split-panel
							class="body"
							primary="start"
							position=${s.navPosition.get()}
							.snap=${navSnap}
							@gl-split-panel-change=${(e: CustomEvent<{ position: number }>) =>
								s.navPosition.set(e.detail.position)}
						>
							<gl-settings-nav
								slot="start"
								class="body__nav"
								.onSelect=${(id: string) => this._actions?.selectCategory(id)}
							></gl-settings-nav>
							<main slot="end" class="body__detail">
								<gl-settings-detail .actions=${this._actions}></gl-settings-detail>
							</main>
						</gl-split-panel>`}
			</div>`;
	}
}
