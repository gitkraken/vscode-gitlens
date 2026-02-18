import type { ConfigurationChangeEvent } from 'vscode';
import { Disposable, languages } from 'vscode';
import type { Container } from '../container.js';
import { configuration } from '../system/-webview/configuration.js';
import { setContext } from '../system/-webview/context.js';
import { debug } from '../system/decorators/log.js';
import { once } from '../system/event.js';
import { getLoggableName } from '../system/logger.js';
import { getScopedLogger, maybeStartLoggableScope } from '../system/logger.scope.js';
import type { DocumentBlameStateChangeEvent, DocumentDirtyIdleTriggerEvent } from '../trackers/documentTracker.js';
import type { GitCodeLensProvider } from './codeLensProvider.js';

export class GitCodeLensController implements Disposable {
	private _canToggle: boolean = false;
	private _disposable: Disposable | undefined;
	private _provider: GitCodeLensProvider | undefined;
	private _providerDisposable: Disposable | undefined;

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			once(container.onReady)(this.onReady, this),
			configuration.onDidChange(this.onConfigurationChanged, this),
		);
	}

	dispose(): void {
		this._providerDisposable?.dispose();
		this._disposable?.dispose();
	}

	private onReady(): void {
		this.onConfigurationChanged();
	}

	private onConfigurationChanged(e?: ConfigurationChangeEvent) {
		using scope = maybeStartLoggableScope(`${getLoggableName(this)}.onConfigurationChanged`);

		if (configuration.changed(e, ['codeLens', 'defaultDateFormat', 'defaultDateSource', 'defaultDateStyle'])) {
			if (e != null) {
				scope?.debug('resetting CodeLens provider');
			}

			const cfg = configuration.get('codeLens');
			if (cfg.enabled && (cfg.recentChange.enabled || cfg.authors.enabled)) {
				void this.ensureProvider();
			} else {
				this._providerDisposable?.dispose();
				this._provider = undefined;
			}

			this._canToggle = cfg.recentChange.enabled || cfg.authors.enabled;
			void setContext('gitlens:disabledToggleCodeLens', !this._canToggle);
		}
	}

	private onBlameStateChanged(e: DocumentBlameStateChangeEvent) {
		// Only reset if we have saved, since the CodeLens won't naturally be re-rendered
		if (this._provider == null || !e.blameable) return;

		using scope = maybeStartLoggableScope(`${getLoggableName(this)}.onBlameStateChanged`);

		scope?.debug('resetting CodeLens provider');
		this._provider.reset();
	}

	private async onDirtyIdleTriggered(e: DocumentDirtyIdleTriggerEvent) {
		if (this._provider == null) return;

		using scope = maybeStartLoggableScope(`${getLoggableName(this)}.onDirtyIdleTriggered`);

		const status = await e.document.getStatus();
		if (!status.blameable) return;

		scope?.debug('resetting CodeLens provider');
		this._provider.reset();
	}

	@debug()
	toggleCodeLens(): void {
		const scope = getScopedLogger();

		if (!this._canToggle) {
			if (scope != null) {
				scope?.addExitInfo('skipped, disabled');
			}
			return;
		}

		if (this._provider != null) {
			this._providerDisposable?.dispose();
			this._provider = undefined;

			return;
		}

		void this.ensureProvider();
	}

	private async ensureProvider() {
		if (this._provider != null) {
			this._provider.reset();

			return;
		}

		this._providerDisposable?.dispose();

		const { GitCodeLensProvider } = await import(/* webpackChunkName: "codelens" */ './codeLensProvider.js');

		this._provider = new GitCodeLensProvider(this.container);
		this._providerDisposable = Disposable.from(
			this._provider,
			languages.registerCodeLensProvider(GitCodeLensProvider.selector, this._provider),
			this.container.documentTracker.onDidChangeBlameState(this.onBlameStateChanged, this),
			this.container.documentTracker.onDidTriggerDirtyIdle(this.onDirtyIdleTriggered, this),
		);
	}
}
