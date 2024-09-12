import type { ConfigurationChangeEvent, Event } from 'vscode';
import { Disposable, EventEmitter, languages } from 'vscode';
import type { Container } from '../container';
import { configuration } from '../system/configuration';
import { setContext } from '../system/context';
import { log } from '../system/decorators/log';
import { once } from '../system/event';
import { getLoggableName, Logger } from '../system/logger';
import { getLogScope, setLogScopeExit, startLogScope } from '../system/logger.scope';
import type { DocumentBlameStateChangeEvent, DocumentDirtyIdleTriggerEvent } from '../trackers/documentTracker';
import type { GitCodeLensProvider } from './codeLensProvider';

export class GitCodeLensController implements Disposable {
	private _canToggle: boolean = false;
	private _disposable: Disposable | undefined;
	private _provider: GitCodeLensProvider | undefined;
	private _providerDisposable: Disposable | undefined;

	private _onCodeLensToggle = new EventEmitter<void>();
	get onCodeLensToggle(): Event<void> {
		return this._onCodeLensToggle.event;
	}

	get canToggle() {
		return this._canToggle;
	}
	get isEnabled() {
		return Boolean(this._provider);
	}

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			once(container.onReady)(this.onReady, this),
			configuration.onDidChange(this.onConfigurationChanged, this),
		);
	}

	dispose() {
		this._providerDisposable?.dispose();
		this._disposable?.dispose();
	}

	private onReady(): void {
		this.onConfigurationChanged();
	}

	private disableCodeLens() {
		this._providerDisposable?.dispose();
		this._provider = undefined;
		this._onCodeLensToggle.fire();
	}

	private onConfigurationChanged(e?: ConfigurationChangeEvent) {
		using scope = startLogScope(`${getLoggableName(this)}.onConfigurationChanged`, false);

		if (configuration.changed(e, ['codeLens', 'defaultDateFormat', 'defaultDateSource', 'defaultDateStyle'])) {
			if (e != null) {
				Logger.log(scope, 'resetting CodeLens provider');
			}
			const cfg = configuration.get('codeLens');
			this._canToggle = cfg.recentChange.enabled || cfg.authors.enabled;

			if (cfg.enabled && (cfg.recentChange.enabled || cfg.authors.enabled)) {
				void this.ensureProvider();
			} else {
				this.disableCodeLens();
			}
			void setContext('gitlens:disabledToggleCodeLens', !this._canToggle);
		}
	}

	private onBlameStateChanged(e: DocumentBlameStateChangeEvent) {
		// Only reset if we have saved, since the CodeLens won't naturally be re-rendered
		if (this._provider == null || !e.blameable) return;

		using scope = startLogScope(`${getLoggableName(this)}.onBlameStateChanged`, false);

		Logger.log(scope, 'resetting CodeLens provider');
		void this.container.usage.track('codeLens:activated');
		// this._provider.reset();
	}

	private async onDirtyIdleTriggered(e: DocumentDirtyIdleTriggerEvent) {
		if (this._provider == null) return;

		using scope = startLogScope(`${getLoggableName(this)}.onDirtyIdleTriggered`, false);

		const status = await e.document.getStatus();
		if (!status.blameable) return;

		Logger.log(scope, 'resetting CodeLens provider');
		// this._provider.reset();
	}

	@log()
	toggleCodeLens() {
		const scope = getLogScope();

		if (!this._canToggle) {
			if (scope != null) {
				setLogScopeExit(scope, ' \u2022 skipped, disabled');
			}
			return;
		}

		if (this._provider != null) {
			this.disableCodeLens();
			return;
		}

		void this.ensureProvider();
	}

	private trackCodeLens() {
		if (!this.container.usage.get('codeLens:activated')) void this.container.usage.track('codeLens:activated');
	}

	private async ensureProvider() {
		if (this._provider != null) {
			// this._provider.reset();

			return;
		}

		this._providerDisposable?.dispose();

		const { GitCodeLensProvider } = await import(/* webpackChunkName: "codelens" */ './codeLensProvider');

		this._provider = new GitCodeLensProvider(this.container);
		this._onCodeLensToggle.fire();

		this._providerDisposable = Disposable.from(
			languages.registerCodeLensProvider(GitCodeLensProvider.selector, this._provider),
			this._provider.onDidChangeCodeLenses(this.trackCodeLens, this),
			this.container.documentTracker.onDidChangeBlameState(this.onBlameStateChanged, this),
			this.container.documentTracker.onDidTriggerDirtyIdle(this.onDirtyIdleTriggered, this),
		);
	}
}
