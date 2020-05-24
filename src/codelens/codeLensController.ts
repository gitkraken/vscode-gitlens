'use strict';
import { ConfigurationChangeEvent, Disposable, languages } from 'vscode';
import { configuration } from '../configuration';
import { CommandContext, setCommandContext } from '../constants';
import { Container } from '../container';
import { Logger } from '../logger';
import {
	DocumentBlameStateChangeEvent,
	DocumentDirtyIdleTriggerEvent,
	GitDocumentState,
} from '../trackers/gitDocumentTracker';
import { GitCodeLensProvider } from './codeLensProvider';

export class GitCodeLensController implements Disposable {
	private _canToggle: boolean = false;
	private _disposable: Disposable | undefined;
	private _provider: GitCodeLensProvider | undefined;
	private _providerDisposable: Disposable | undefined;

	constructor() {
		this._disposable = Disposable.from(configuration.onDidChange(this.onConfigurationChanged, this));
		this.onConfigurationChanged(configuration.initializingChangeEvent);
	}

	dispose() {
		this._providerDisposable?.dispose();
		this._disposable?.dispose();
	}

	private onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (
			configuration.changed(e, 'codeLens') ||
			configuration.changed(e, 'defaultDateFormat') ||
			configuration.changed(e, 'defaultDateSource') ||
			configuration.changed(e, 'defaultDateStyle')
		) {
			if (!configuration.initializing(e)) {
				Logger.log('CodeLens config changed; resetting CodeLens provider');
			}

			const cfg = Container.config.codeLens;
			if (cfg.enabled && (cfg.recentChange.enabled || cfg.authors.enabled)) {
				this.ensureProvider();
			} else {
				this._providerDisposable?.dispose();
				this._provider = undefined;
			}

			this._canToggle = cfg.recentChange.enabled || cfg.authors.enabled;
			void setCommandContext(CommandContext.CanToggleCodeLens, this._canToggle);
		}
	}

	private onBlameStateChanged(e: DocumentBlameStateChangeEvent<GitDocumentState>) {
		// Only reset if we have saved, since the code lens won't naturally be re-rendered
		if (this._provider === undefined || !e.blameable) return;

		Logger.log('Blame state changed; resetting CodeLens provider');
		this._provider.reset('saved');
	}

	private onDirtyIdleTriggered(e: DocumentDirtyIdleTriggerEvent<GitDocumentState>) {
		if (this._provider === undefined || !e.document.isBlameable) return;

		const maxLines = Container.config.advanced.blame.sizeThresholdAfterEdit;
		if (maxLines > 0 && e.document.lineCount > maxLines) return;

		Logger.log('Dirty idle triggered; resetting CodeLens provider');
		this._provider.reset('idle');
	}

	toggleCodeLens() {
		if (!this._canToggle) return;

		Logger.log('toggleCodeLens()');
		if (this._provider !== undefined) {
			this._providerDisposable?.dispose();
			this._provider = undefined;

			return;
		}

		this.ensureProvider();
	}

	private ensureProvider() {
		if (this._provider !== undefined) {
			this._provider.reset();

			return;
		}

		this._providerDisposable?.dispose();

		this._provider = new GitCodeLensProvider(Container.context, Container.git, Container.tracker);
		this._providerDisposable = Disposable.from(
			languages.registerCodeLensProvider(GitCodeLensProvider.selector, this._provider),
			Container.tracker.onDidChangeBlameState(this.onBlameStateChanged, this),
			Container.tracker.onDidTriggerDirtyIdle(this.onDirtyIdleTriggered, this),
		);
	}
}
