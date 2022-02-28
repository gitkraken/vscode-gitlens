import { ConfigurationTarget, MessageItem, window } from 'vscode';
import { configuration } from './configuration';
import { Commands } from './constants';
import { GitCommit } from './git/models';
import { Logger } from './logger';
import { executeCommand } from './system/command';

export const enum SuppressedMessages {
	CommitHasNoPreviousCommitWarning = 'suppressCommitHasNoPreviousCommitWarning',
	CommitNotFoundWarning = 'suppressCommitNotFoundWarning',
	CreatePullRequestPrompt = 'suppressCreatePullRequestPrompt',
	SuppressDebugLoggingWarning = 'suppressDebugLoggingWarning',
	FileNotUnderSourceControlWarning = 'suppressFileNotUnderSourceControlWarning',
	GitDisabledWarning = 'suppressGitDisabledWarning',
	GitMissingWarning = 'suppressGitMissingWarning',
	GitVersionWarning = 'suppressGitVersionWarning',
	LineUncommittedWarning = 'suppressLineUncommittedWarning',
	NoRepositoryWarning = 'suppressNoRepositoryWarning',
	RebaseSwitchToTextWarning = 'suppressRebaseSwitchToTextWarning',
}

export class Messages {
	static showCommitHasNoPreviousCommitWarningMessage(commit?: GitCommit): Promise<MessageItem | undefined> {
		if (commit == null) {
			return Messages.showMessage(
				'info',
				'There is no previous commit.',
				SuppressedMessages.CommitHasNoPreviousCommitWarning,
			);
		}
		return Messages.showMessage(
			'info',
			`Commit ${commit.shortSha} (${commit.author.name}, ${commit.formattedDate}) has no previous commit.`,
			SuppressedMessages.CommitHasNoPreviousCommitWarning,
		);
	}

	static showCommitNotFoundWarningMessage(message: string): Promise<MessageItem | undefined> {
		return Messages.showMessage(
			'warn',
			`${message}. The commit could not be found.`,
			SuppressedMessages.CommitNotFoundWarning,
		);
	}

	static async showCreatePullRequestPrompt(branch: string): Promise<boolean> {
		const create = { title: 'Create Pull Request...' };
		const result = await Messages.showMessage(
			'info',
			`Would you like to create a Pull Request for branch '${branch}'?`,
			SuppressedMessages.CreatePullRequestPrompt,
			{ title: "Don't Show Again" },
			create,
		);
		return result === create;
	}

	static async showDebugLoggingWarningMessage(): Promise<boolean> {
		const disable = { title: 'Disable Debug Logging' };
		const result = await Messages.showMessage(
			'warn',
			'GitLens debug logging is currently enabled. Unless you are reporting an issue, it is recommended to be disabled. Would you like to disable it?',
			SuppressedMessages.SuppressDebugLoggingWarning,
			{ title: "Don't Show Again" },
			disable,
		);

		return result === disable;
	}

	static async showGenericErrorMessage(message: string): Promise<MessageItem | undefined> {
		const actions: MessageItem[] = [{ title: 'Open Output Channel' }];
		const result = await Messages.showMessage(
			'error',
			`${message}. See output channel for more details`,
			undefined,
			null,
			...actions,
		);

		if (result !== undefined) {
			Logger.showOutputChannel();
		}
		return result;
	}

	static showFileNotUnderSourceControlWarningMessage(message: string): Promise<MessageItem | undefined> {
		return Messages.showMessage(
			'warn',
			`${message}. The file is probably not under source control.`,
			SuppressedMessages.FileNotUnderSourceControlWarning,
		);
	}

	static showGitDisabledErrorMessage() {
		return Messages.showMessage(
			'error',
			'GitLens requires Git to be enabled. Please re-enable Git \u2014 set `git.enabled` to true and reload.',
			SuppressedMessages.GitDisabledWarning,
		);
	}

	static showGitInvalidConfigErrorMessage() {
		return Messages.showMessage(
			'error',
			'GitLens is unable to use Git. Your Git configuration seems to be invalid. Please resolve any issues with your Git configuration and reload.',
		);
	}

	static showGitMissingErrorMessage() {
		return Messages.showMessage(
			'error',
			"GitLens was unable to find Git. Please make sure Git is installed. Also ensure that Git is either in the PATH, or that 'git.path' is pointed to its installed location.",
			SuppressedMessages.GitMissingWarning,
		);
	}

	static showGitVersionUnsupportedErrorMessage(version: string, required: string): Promise<MessageItem | undefined> {
		return Messages.showMessage(
			'error',
			`GitLens requires a newer version of Git (>= ${required}) than is currently installed (${version}). Please install a more recent version of Git.`,
			SuppressedMessages.GitVersionWarning,
		);
	}

	static showInsidersErrorMessage() {
		return Messages.showMessage(
			'error',
			'GitLens (Insiders) cannot be used while GitLens is also enabled. Please ensure that only one version is enabled.',
			SuppressedMessages.GitDisabledWarning,
		);
	}

	static showLineUncommittedWarningMessage(message: string): Promise<MessageItem | undefined> {
		return Messages.showMessage(
			'warn',
			`${message}. The line has uncommitted changes.`,
			SuppressedMessages.LineUncommittedWarning,
		);
	}

	static showNoRepositoryWarningMessage(message: string): Promise<MessageItem | undefined> {
		return Messages.showMessage(
			'warn',
			`${message}. No repository could be found.`,
			SuppressedMessages.NoRepositoryWarning,
		);
	}

	static showRebaseSwitchToTextWarningMessage(): Promise<MessageItem | undefined> {
		return Messages.showMessage(
			'warn',
			'Closing either the git-rebase-todo file or the Rebase Editor will start the rebase.',
			SuppressedMessages.RebaseSwitchToTextWarning,
		);
	}

	static async showWhatsNewMessage(version: string) {
		const whatsnew = { title: "See What's New" };
		const result = await Messages.showMessage(
			'info',
			`GitLens ${version} is here — check out what's new!`,
			undefined,
			null,
			whatsnew,
		);

		if (result === whatsnew) {
			void (await executeCommand(Commands.ShowWelcomePage));
		}
	}

	private static async showMessage(
		type: 'info' | 'warn' | 'error',
		message: string,
		suppressionKey?: SuppressedMessages,
		dontShowAgain: MessageItem | null = { title: "Don't Show Again" },
		...actions: MessageItem[]
	): Promise<MessageItem | undefined> {
		Logger.log(`ShowMessage(${type}, '${message}', ${suppressionKey}, ${JSON.stringify(dontShowAgain)})`);

		if (suppressionKey !== undefined && configuration.get(`advanced.messages.${suppressionKey}` as const)) {
			Logger.log(
				`ShowMessage(${type}, '${message}', ${suppressionKey}, ${JSON.stringify(dontShowAgain)}) skipped`,
			);
			return undefined;
		}

		if (suppressionKey !== undefined && dontShowAgain !== null) {
			actions.push(dontShowAgain);
		}

		let result: MessageItem | undefined = undefined;
		switch (type) {
			case 'info':
				result = await window.showInformationMessage(message, ...actions);
				break;

			case 'warn':
				result = await window.showWarningMessage(message, ...actions);
				break;

			case 'error':
				result = await window.showErrorMessage(message, ...actions);
				break;
		}

		if ((suppressionKey !== undefined && dontShowAgain === null) || result === dontShowAgain) {
			Logger.log(
				`ShowMessage(${type}, '${message}', ${suppressionKey}, ${JSON.stringify(
					dontShowAgain,
				)}) don't show again requested`,
			);
			await this.suppressedMessage(suppressionKey!);

			if (result === dontShowAgain) return undefined;
		}

		Logger.log(
			`ShowMessage(${type}, '${message}', ${suppressionKey}, ${JSON.stringify(dontShowAgain)}) returned ${
				result != null ? result.title : result
			}`,
		);
		return result;
	}

	private static suppressedMessage(suppressionKey: SuppressedMessages) {
		const messages = { ...configuration.get('advanced.messages') };

		messages[suppressionKey] = true;

		for (const [key, value] of Object.entries(messages)) {
			if (value !== true) {
				delete messages[key as keyof typeof messages];
			}
		}

		return configuration.update('advanced.messages', messages, ConfigurationTarget.Global);
	}
}
