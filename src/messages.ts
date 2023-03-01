import type { MessageItem } from 'vscode';
import { ConfigurationTarget, env, Uri, window } from 'vscode';
import { SuppressedMessages } from './config';
import { Commands } from './constants';
import type { GitCommit } from './git/models/commit';
import { executeCommand } from './system/command';
import { configuration } from './system/configuration';
import { Logger } from './system/logger';
import { LogLevel } from './system/logger.constants';

export function showCommitHasNoPreviousCommitWarningMessage(commit?: GitCommit): Promise<MessageItem | undefined> {
	if (commit == null) {
		return showMessage('info', 'There is no previous commit.', SuppressedMessages.CommitHasNoPreviousCommitWarning);
	}
	return showMessage(
		'info',
		`Commit ${commit.shortSha} (${commit.author.name}, ${commit.formattedDate}) has no previous commit.`,
		SuppressedMessages.CommitHasNoPreviousCommitWarning,
	);
}

export function showCommitNotFoundWarningMessage(message: string): Promise<MessageItem | undefined> {
	return showMessage('warn', `${message}. The commit could not be found.`, SuppressedMessages.CommitNotFoundWarning);
}

export async function showCreatePullRequestPrompt(branch: string): Promise<boolean> {
	const create = { title: 'Create Pull Request...' };
	const result = await showMessage(
		'info',
		`Would you like to create a Pull Request for branch '${branch}'?`,
		SuppressedMessages.CreatePullRequestPrompt,
		{ title: "Don't Show Again" },
		create,
	);
	return result === create;
}

export async function showDebugLoggingWarningMessage(): Promise<boolean> {
	const disable = { title: 'Disable Debug Logging' };
	const result = await showMessage(
		'warn',
		'GitLens debug logging is currently enabled. Unless you are reporting an issue, it is recommended to be disabled. Would you like to disable it?',
		SuppressedMessages.SuppressDebugLoggingWarning,
		{ title: "Don't Show Again" },
		disable,
	);

	return result === disable;
}

export async function showGenericErrorMessage(message: string): Promise<void> {
	if (Logger.enabled(LogLevel.Error)) {
		const result = await showMessage('error', `${message}. See output channel for more details.`, undefined, null, {
			title: 'Open Output Channel',
		});

		if (result != null) {
			Logger.showOutputChannel();
		}
	} else {
		const result = await showMessage(
			'error',
			`${message}. If the error persists, please enable debug logging and try again.`,
			undefined,
			null,
			{
				title: 'Enable Debug Logging',
			},
		);

		if (result != null) {
			void executeCommand(Commands.EnableDebugLogging);
		}
	}
}

export function showFileNotUnderSourceControlWarningMessage(message: string): Promise<MessageItem | undefined> {
	return showMessage(
		'warn',
		`${message}. The file is probably not under source control.`,
		SuppressedMessages.FileNotUnderSourceControlWarning,
	);
}

export function showGitDisabledErrorMessage() {
	return showMessage(
		'error',
		'GitLens requires Git to be enabled. Please re-enable Git \u2014 set `git.enabled` to true and reload.',
		SuppressedMessages.GitDisabledWarning,
	);
}

export function showGitInvalidConfigErrorMessage() {
	return showMessage(
		'error',
		'GitLens is unable to use Git. Your Git configuration seems to be invalid. Please resolve any issues with your Git configuration and reload.',
	);
}

export function showGitMissingErrorMessage() {
	return showMessage(
		'error',
		"GitLens was unable to find Git. Please make sure Git is installed. Also ensure that Git is either in the PATH, or that 'git.path' is pointed to its installed location.",
		SuppressedMessages.GitMissingWarning,
	);
}

export function showGitVersionUnsupportedErrorMessage(
	version: string,
	required: string,
): Promise<MessageItem | undefined> {
	return showMessage(
		'error',
		`GitLens requires a newer version of Git (>= ${required}) than is currently installed (${version}). Please install a more recent version of Git.`,
		SuppressedMessages.GitVersionWarning,
	);
}

export function showInsidersErrorMessage() {
	return showMessage(
		'error',
		'GitLens (Insiders) cannot be used while GitLens is also enabled. Please ensure that only one version is enabled.',
	);
}

export function showPreReleaseExpiredErrorMessage(version: string, insiders: boolean) {
	return showMessage(
		'error',
		`This GitLens ${
			insiders ? '(Insiders)' : 'pre-release'
		} version (${version}) has expired. Please upgrade to a more recent version.`,
	);
}

export function showLineUncommittedWarningMessage(message: string): Promise<MessageItem | undefined> {
	return showMessage(
		'warn',
		`${message}. The line has uncommitted changes.`,
		SuppressedMessages.LineUncommittedWarning,
	);
}

export function showNoRepositoryWarningMessage(message: string): Promise<MessageItem | undefined> {
	return showMessage('warn', `${message}. No repository could be found.`, SuppressedMessages.NoRepositoryWarning);
}

export function showRebaseSwitchToTextWarningMessage(): Promise<MessageItem | undefined> {
	return showMessage(
		'warn',
		'Closing either the git-rebase-todo file or the Rebase Editor will start the rebase.',
		SuppressedMessages.RebaseSwitchToTextWarning,
	);
}

export function showIntegrationDisconnectedTooManyFailedRequestsWarningMessage(
	providerName: string,
): Promise<MessageItem | undefined> {
	return showMessage(
		'error',
		`Rich integration with ${providerName} has been disconnected for this session, because of too many failed requests.`,
		SuppressedMessages.IntegrationDisconnectedTooManyFailedRequestsWarning,
		undefined,
		{
			title: 'OK',
		},
	);
}

export function showIntegrationRequestFailed500WarningMessage(message: string): Promise<MessageItem | undefined> {
	return showMessage('error', message, SuppressedMessages.IntegrationRequestFailed500Warning, undefined, {
		title: 'OK',
	});
}

export function showIntegrationRequestTimedOutWarningMessage(providerName: string): Promise<MessageItem | undefined> {
	return showMessage(
		'error',
		`${providerName} request timed out.`,
		SuppressedMessages.IntegrationRequestTimedOutWarning,
		undefined,
		{
			title: 'OK',
		},
	);
}

export async function showWhatsNewMessage(version: string) {
	const whatsnew = { title: "See What's New" };
	const result = await showMessage(
		'info',
		`GitLens ${version} is here — check out what's new!`,
		undefined,
		null,
		whatsnew,
	);

	if (result === whatsnew) {
		void (await env.openExternal(Uri.parse('https://help.gitkraken.com/gitlens/gitlens-release-notes-current/')));
	}
}

export async function showMessage(
	type: 'info' | 'warn' | 'error',
	message: string,
	suppressionKey?: SuppressedMessages,
	dontShowAgain: MessageItem | null = { title: "Don't Show Again" },
	...actions: MessageItem[]
): Promise<MessageItem | undefined> {
	Logger.log(`ShowMessage(${type}, '${message}', ${suppressionKey}, ${JSON.stringify(dontShowAgain)})`);

	if (suppressionKey != null && configuration.get(`advanced.messages.${suppressionKey}` as const)) {
		Logger.log(`ShowMessage(${type}, '${message}', ${suppressionKey}, ${JSON.stringify(dontShowAgain)}) skipped`);
		return undefined;
	}

	if (suppressionKey != null && dontShowAgain !== null) {
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

	if (suppressionKey != null && (dontShowAgain === null || result === dontShowAgain)) {
		Logger.log(
			`ShowMessage(${type}, '${message}', ${suppressionKey}, ${JSON.stringify(
				dontShowAgain,
			)}) don't show again requested`,
		);
		await suppressedMessage(suppressionKey);

		if (result === dontShowAgain) return undefined;
	}

	Logger.log(
		`ShowMessage(${type}, '${message}', ${suppressionKey}, ${JSON.stringify(dontShowAgain)}) returned ${
			result != null ? result.title : result
		}`,
	);
	return result;
}

function suppressedMessage(suppressionKey: SuppressedMessages) {
	const messages = { ...configuration.get('advanced.messages') };

	messages[suppressionKey] = true;

	for (const [key, value] of Object.entries(messages)) {
		if (value !== true) {
			delete messages[key as keyof typeof messages];
		}
	}

	return configuration.update('advanced.messages', messages, ConfigurationTarget.Global);
}
