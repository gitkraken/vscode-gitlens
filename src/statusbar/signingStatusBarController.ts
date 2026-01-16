import type { ConfigurationChangeEvent, StatusBarItem } from 'vscode';
import { Disposable, MarkdownString, StatusBarAlignment, window } from 'vscode';
import type { GlCommands } from '../constants.commands.js';
import type { Container } from '../container.js';
import { configuration } from '../system/-webview/configuration.js';
import { once } from '../system/event.js';

export class SigningStatusBarController implements Disposable {
	private readonly _disposable: Disposable;
	private _statusBarItem: StatusBarItem | undefined;

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			configuration.onDidChange(this.onConfigurationChanged, this),
			once(container.onReady)(() => queueMicrotask(() => this.updateStatusBar())),
			container.git.onDidChangeRepositories(() => this.updateStatusBar()),
			{ dispose: () => this._statusBarItem?.dispose() },
		);
	}

	dispose(): void {
		this._disposable.dispose();
	}

	private onConfigurationChanged(e?: ConfigurationChangeEvent) {
		if (!configuration.changed(e, 'signing.showStatusBar')) return;

		void this.updateStatusBar();
	}

	private async updateStatusBar() {
		const enabled = configuration.get('signing.showStatusBar');

		if (!enabled) {
			this._statusBarItem?.dispose();
			this._statusBarItem = undefined;
			return;
		}

		// Get the best repository
		const repository = this.container.git.getBestRepository();
		if (repository == null) {
			this._statusBarItem?.dispose();
			this._statusBarItem = undefined;
			return;
		}

		// Get signing configuration
		const signingConfig = await repository.git.config.getSigningConfig?.();

		// Create status bar item if it doesn't exist
		if (this._statusBarItem == null) {
			this._statusBarItem = window.createStatusBarItem(
				'gitlens.signing',
				StatusBarAlignment.Left,
				10000 - 4, // Position after Launchpad (10000 - 3)
			);
			this._statusBarItem.name = 'GitLens Commit Signing';
			this._statusBarItem.command = 'gitlens.git.setupCommitSigning' satisfies GlCommands;
		}

		// Update status bar based on signing configuration
		if (signingConfig?.enabled && signingConfig?.signingKey) {
			// Signing is configured and enabled
			const format = signingConfig.format.toUpperCase();
			this._statusBarItem.text = `$(key) ${format}`;
			this._statusBarItem.tooltip = new MarkdownString(
				`**Commit Signing: Enabled**\n\nFormat: ${format}\n\nClick to reconfigure or test signing`,
				true,
			);
			this._statusBarItem.accessibilityInformation = {
				label: `Commit signing is enabled using ${format}. Click to reconfigure or test signing.`,
			};
		} else {
			// Signing is not configured
			this._statusBarItem.text = '$(key) Sign';
			this._statusBarItem.tooltip = new MarkdownString(
				'**Commit Signing: Not Configured**\n\nClick to setup commit signing',
				true,
			);
			this._statusBarItem.accessibilityInformation = {
				label: 'Commit signing is not configured. Click to setup commit signing.',
			};
		}

		this._statusBarItem.show();
	}
}
