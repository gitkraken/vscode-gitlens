import type { CancellationToken, ConfigurationChangeEvent, Disposable } from 'vscode';
import { ProgressLocation, ThemeIcon, window } from 'vscode';
import type {
	CommitMessageProvider,
	API as ScmGitApi,
	Repository as ScmGitRepository,
} from '../../../@types/vscode.git';
import type { Container } from '../../../container';
import { log } from '../../../system/decorators/log';
import { Logger } from '../../../system/logger';
import { getLogScope } from '../../../system/logger.scope';
import { configuration } from '../../../system/vscode/configuration';

class AICommitMessageProvider implements CommitMessageProvider, Disposable {
	icon: ThemeIcon = new ThemeIcon('sparkle');
	title: string = 'Generate Commit Message (Experimental)';

	private readonly _disposable: Disposable;
	private _subscription: Disposable | undefined;

	constructor(
		private readonly container: Container,
		private readonly scmGit: ScmGitApi,
	) {
		this._disposable = configuration.onDidChange(this.onConfigurationChanged, this);

		this.onConfigurationChanged();
	}

	private onConfigurationChanged(e?: ConfigurationChangeEvent) {
		if (e == null || configuration.changed(e, 'ai.generateCommitMessage.enabled')) {
			if (configuration.get('ai.generateCommitMessage.enabled')) {
				this._subscription = this.scmGit.registerCommitMessageProvider(this);
			} else {
				this._subscription?.dispose();
				this._subscription = undefined;
			}
		}
	}

	dispose() {
		this._subscription?.dispose();
		this._disposable.dispose();
	}

	@log({ args: false })
	async provideCommitMessage(repository: ScmGitRepository, changes: string[], cancellation: CancellationToken) {
		const scope = getLogScope();

		const currentMessage = repository.inputBox.value;
		try {
			const message = await (
				await this.container.ai
			)?.generateCommitMessage(
				changes,
				{ source: 'scm-input' },
				{
					cancellation: cancellation,
					context: currentMessage,
					progress: {
						location: ProgressLocation.Notification,
						title: 'Generating commit message...',
					},
				},
			);

			if (message == null) return;
			return `${currentMessage ? `${currentMessage}\n\n` : ''}${message.summary}\n\n${message.body}`;
		} catch (ex) {
			Logger.error(ex, scope);

			if (ex instanceof Error && ex.message.startsWith('No changes')) {
				void window.showInformationMessage('No changes to generate a commit message from.');
				return;
			}

			return undefined;
		}
	}
}

export function registerCommitMessageProvider(container: Container, scmGit: ScmGitApi): Disposable | undefined {
	return typeof scmGit.registerCommitMessageProvider === 'function'
		? new AICommitMessageProvider(container, scmGit)
		: undefined;
}
