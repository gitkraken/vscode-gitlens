import type { MessageItem } from 'vscode';
import { ConfigurationTarget, l10n, ThemeIcon, window } from 'vscode';
import type { BlameIgnoreRevsFileError, GitCommandContext } from '@gitlens/git/errors.js';
import { BlameIgnoreRevsFileBadRevisionError, GitCommandError } from '@gitlens/git/errors.js';
import type { GitCommit } from '@gitlens/git/models/commit.js';
import { filterMap } from '@gitlens/utils/array.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { SuppressedMessages } from './config.js';
import { urls } from './constants.js';
import type { Source } from './constants.telemetry.js';
import type { Container } from './container.js';
import { getPresentableErrorMessage } from './errors.js';
import { formatIdentityDisplayName, getCommitFormattedDate } from './git/utils/-webview/commit.utils.js';
import { executeCommand, executeCoreCommand } from './system/-webview/command.js';
import { configuration } from './system/-webview/configuration.js';
import { openTerminal } from './system/-webview/terminal.js';
import { openUrl } from './system/-webview/vscode/uris.js';

export function showBlameInvalidIgnoreRevsFileWarningMessage(
	ex: BlameIgnoreRevsFileError | BlameIgnoreRevsFileBadRevisionError,
): Promise<MessageItem | undefined> {
	if (ex instanceof BlameIgnoreRevsFileBadRevisionError) {
		return showMessage(
			'error',
			l10n.t(
				'Unable to show blame. Invalid revision ({0}) specified in the blame.ignoreRevsFile in your Git config.',
				ex.revision,
			),
			'suppressBlameInvalidIgnoreRevsFileBadRevisionWarning',
		);
	}

	return showMessage(
		'error',
		l10n.t(
			'Unable to show blame. Invalid or missing blame.ignoreRevsFile ({0}) specified in your Git config.',
			ex.fileName,
		),
		'suppressBlameInvalidIgnoreRevsFileWarning',
	);
}

export function showCommitHasNoPreviousCommitWarningMessage(commit?: GitCommit): Promise<MessageItem | undefined> {
	if (commit == null) {
		return showMessage('info', l10n.t('There is no previous commit.'), 'suppressCommitHasNoPreviousCommitWarning');
	}
	return showMessage(
		'info',
		l10n.t(
			'Commit {0} ({1}, {2}) has no previous commit.',
			commit.shortSha,
			formatIdentityDisplayName(commit.author),
			getCommitFormattedDate(commit),
		),
		'suppressCommitHasNoPreviousCommitWarning',
	);
}

export function showCommitNotFoundWarningMessage(message: string): Promise<MessageItem | undefined> {
	return showMessage('warn', l10n.t('{0}. The commit could not be found.', message), 'suppressCommitNotFoundWarning');
}

export async function showCreatePullRequestPrompt(branch: string): Promise<boolean> {
	const create = { title: l10n.t('Create Pull Request...') };
	const result = await showMessage(
		'info',
		l10n.t("Would you like to create a Pull Request for branch '{0}'?", branch),
		'suppressCreatePullRequestPrompt',
		{ title: l10n.t("Don't Show Again") },
		create,
	);
	return result === create;
}

export async function showDebugLoggingWarningMessage(): Promise<boolean> {
	const disable = { title: l10n.t('Disable Debug Logging') };
	const result = await showMessage(
		'warn',
		l10n.t(
			'GitLens debug logging is currently enabled. Unless you are reporting an issue, it is recommended to be disabled. Would you like to disable it?',
		),
		'suppressDebugLoggingWarning',
		{ title: l10n.t("Don't Show Again") },
		disable,
	);

	return result === disable;
}

export async function showGenericErrorMessage(message: string): Promise<void> {
	if (Logger.enabled('error')) {
		const result = await showMessage(
			'error',
			l10n.t('{0}. See output channel for more details.', message),
			undefined,
			null,
			{
				title: l10n.t('Open Output Channel'),
			},
		);

		if (result != null) {
			Logger.showOutputChannel();
		}
	} else {
		const result = await showMessage(
			'error',
			l10n.t('{0}. If the error persists, please enable debug logging and try again.', message),
			undefined,
			null,
			{
				title: l10n.t('Enable Debug Logging'),
			},
		);

		if (result != null) {
			void executeCommand('gitlens.enableDebugLogging');
		}
	}
}

function escapeShellArg(arg: string): string {
	// If the argument contains spaces, quotes, or special characters, wrap it in single quotes
	// and escape any single quotes within it
	if (/[\s"'`$\\|&;<>(){}[\]!*?#~]/.test(arg)) {
		// Escape single quotes by replacing ' with '\''
		return `'${arg.replace(/'/g, "'\\''")}'`;
	}
	return arg;
}

function showGitCommandInTerminal(gitCommand: GitCommandContext, error: GitCommandError<any>): void {
	const terminal = openTerminal({
		cwd: gitCommand.repoPath,
		name: 'GitLens',
		hideFromUser: false,
		iconPath: new ThemeIcon('gitlens-gitlens'),
		isTransient: true,
		message: l10n.t(
			'\x1b[1mGitLens attempted to run this Git command and it failed:\x1b[0m\r\n\x1b[31m{0}\x1b[0m\r\n\x1b[3mYou can run it again or modify it to diagnose the issue.\x1b[0m\r\n',
			error.localizedMessage,
		),
	});
	const command = `git ${filterMap(gitCommand.args, a => (a != null ? escapeShellArg(a) : undefined)).join(' ')}`;
	terminal.sendText(command, false);
	terminal.show();
}

export async function showGitErrorMessage(error: Error | GitCommandError<any>, message?: string): Promise<void> {
	if (!GitCommandError.is(error)) {
		return void showGenericErrorMessage(message ?? getPresentableErrorMessage(error));
	}

	const { gitCommand } = error.details;
	message = message ?? error.localizedMessage;
	const loggingEnabled = Logger.enabled('error');

	const openOutputChannelOrEnableLogging: MessageItem = {
		title: loggingEnabled ? l10n.t('Open Output Channel') : l10n.t('Enable Debug Logging'),
	};
	const openInTerminalAction: MessageItem = { title: l10n.t('Open in Terminal') };
	const baseMessage = message.endsWith('.') ? message : `${message}.`;

	const result = await showMessage(
		'error',
		loggingEnabled
			? l10n.t('{0} See output channel for more details.', baseMessage)
			: l10n.t('{0} If the error persists, please enable debug logging and try again.', baseMessage),
		undefined,
		null,
		...(gitCommand != null
			? [openInTerminalAction, openOutputChannelOrEnableLogging]
			: [openOutputChannelOrEnableLogging]),
	);

	if (result === openInTerminalAction) {
		showGitCommandInTerminal(gitCommand, error);
		return;
	}

	if (result === openOutputChannelOrEnableLogging) {
		if (loggingEnabled) {
			Logger.showOutputChannel();
		} else {
			void executeCommand('gitlens.enableDebugLogging');
		}
	}
}

export async function showBitbucketPRCommitLinksAppNotInstalledWarningMessage(revLink: string): Promise<void> {
	const allowAccess = { title: l10n.t('Allow Access') };
	const result = await showMessage(
		'warn',
		l10n.t(
			'GitLens cannot access Bitbucket PRs for commits.\nAllow access by visiting [this commit]({0}) on Bitbucket and click “Pull requests” under the “Apps” section on the bottom right\nor [read our docs](https://help.gitkraken.com/gitlens/gitlens-troubleshooting/#enable-showing-bitbucket-pull-request-for-a-commit) for more info.',
			revLink,
		),
		'suppressBitbucketPRCommitLinksAppNotInstalledWarning',
		{ title: l10n.t("Don't Show Again") },
		allowAccess,
	);
	if (result === allowAccess) {
		void openUrl(revLink);
	}
}

export function showFileNotUnderSourceControlWarningMessage(message: string): Promise<MessageItem | undefined> {
	return showMessage(
		'warn',
		l10n.t('{0}. The file is probably not under source control.', message),
		'suppressFileNotUnderSourceControlWarning',
	);
}

export function showGitDisabledErrorMessage(): Promise<MessageItem | undefined> {
	return showMessage(
		'error',
		l10n.t('GitLens requires Git to be enabled. Please re-enable Git — set `git.enabled` to true and reload.'),
		'suppressGitDisabledWarning',
	);
}

export function showGitInvalidConfigErrorMessage(): Promise<MessageItem | undefined> {
	return showMessage(
		'error',
		l10n.t(
			'GitLens is unable to use Git. Your Git configuration seems to be invalid. Please resolve any issues with your Git configuration and reload.',
		),
	);
}

export function showGitMissingErrorMessage(): Promise<MessageItem | undefined> {
	return showMessage(
		'error',
		l10n.t(
			"GitLens was unable to find Git. Please make sure Git is installed. Also ensure that Git is either in the PATH, or that 'git.path' is pointed to its installed location.",
		),
		'suppressGitMissingWarning',
	);
}

export function showGitVersionUnsupportedErrorMessage(
	version: string,
	required: string,
): Promise<MessageItem | undefined> {
	return showMessage(
		'error',
		l10n.t(
			'GitLens requires a newer version of Git (>= {0}) than is currently installed ({1}). Please install a more recent version of Git.',
			required,
			version,
		),
		'suppressGitVersionWarning',
	);
}

export async function showPreReleaseExpiredErrorMessage(version: string): Promise<void> {
	const upgrade = { title: l10n.t('Upgrade') };
	const switchToRelease = { title: l10n.t('Switch to Release Version') };
	const result = await showMessage(
		'error',
		l10n.t(
			'This pre-release version ({0}) of GitLens has expired. Please upgrade to a more recent pre-release, or switch to the release version.',
			version,
		),
		undefined,
		null,
		upgrade,
		switchToRelease,
	);

	if (result === upgrade) {
		void executeCoreCommand('workbench.extensions.installExtension', 'eamodio.gitlens', {
			installPreReleaseVersion: true,
		});
		void executeCoreCommand('workbench.extensions.action.extensionUpdates');
	} else if (result === switchToRelease) {
		void executeCoreCommand('workbench.extensions.action.installExtensions');
		void executeCoreCommand('workbench.extensions.action.switchToRelease', 'eamodio.gitlens');
	}
}

export function showLineUncommittedWarningMessage(message: string): Promise<MessageItem | undefined> {
	return showMessage(
		'warn',
		l10n.t('{0}. The line has uncommitted changes.', message),
		'suppressLineUncommittedWarning',
	);
}

export function showNoRepositoryWarningMessage(message: string): Promise<MessageItem | undefined> {
	return showMessage('warn', l10n.t('{0}. No repository could be found.', message), 'suppressNoRepositoryWarning');
}

export function showGkDisconnectedTooManyFailedRequestsWarningMessage(): Promise<MessageItem | undefined> {
	return showMessage(
		'error',
		l10n.t('Requests to GitKraken have stopped being sent for this session, because of too many failed requests.'),
		'suppressGkDisconnectedTooManyFailedRequestsWarningMessage',
		undefined,
		{
			title: l10n.t('OK'),
		},
	);
}

export function showGkRequestFailed500WarningMessage(message: string): Promise<MessageItem | undefined> {
	return showMessage('error', message, 'suppressGkRequestFailed500Warning', undefined, {
		title: l10n.t('OK'),
	});
}

export function showGkRequestTimedOutWarningMessage(): Promise<MessageItem | undefined> {
	return showMessage('error', l10n.t('GitKraken request timed out.'), 'suppressGkRequestTimedOutWarning', undefined, {
		title: l10n.t('OK'),
	});
}

export function showIntegrationDisconnectedTooManyFailedRequestsWarningMessage(
	providerName: string,
): Promise<MessageItem | undefined> {
	return showMessage(
		'error',
		l10n.t(
			'Rich integration with {0} has been disconnected for this session, because of too many failed requests.',
			providerName,
		),
		'suppressIntegrationDisconnectedTooManyFailedRequestsWarning',
		undefined,
		{
			title: l10n.t('OK'),
		},
	);
}

export function showIntegrationRequestFailed500WarningMessage(message: string): Promise<MessageItem | undefined> {
	return showMessage('error', message, 'suppressIntegrationRequestFailed500Warning', undefined, {
		title: l10n.t('OK'),
	});
}

export function showIntegrationRequestTimedOutWarningMessage(providerName: string): Promise<MessageItem | undefined> {
	return showMessage(
		'error',
		l10n.t('{0} request timed out.', providerName),
		'suppressIntegrationRequestTimedOutWarning',
		undefined,
		{
			title: l10n.t('OK'),
		},
	);
}

export async function showWhatsNewMessage(majorVersion: string): Promise<void> {
	const confirm = { title: l10n.t('OK'), isCloseAffordance: true };
	const releaseNotes = { title: l10n.t('View Release Notes') };
	const openWalkthrough = { title: l10n.t('Open Walkthrough') };
	const openGraph = { title: l10n.t('Show Commit Graph') };

	let message: string;
	switch (majorVersion) {
		case '19':
			message = l10n.t(
				'GitLens 19 is here — the Commit Graph has been rebuilt from the ground up: dramatically faster, lighter, now the heart of GitLens, with new and enhanced workflows from code to merge.',
			);
			break;
		case '18':
			message = l10n.t(
				'GitLens upgraded to 18 — the Commit Graph is all new with agent integration, multi-worktree WIP rows, AI-powered Review and Compose modes, and more.',
			);
			break;
		case '17':
			message = l10n.t(
				'GitLens upgraded to 17 with the all new [GitKraken AI](https://gitkraken.com/solutions/gitkraken-ai?source=gitlens&product=gitlens&utm_source=gitlens-extension&utm_medium=in-app-links) access included in GitLens Pro, AI changelog and pull request creation, and Bitbucket integration.',
			);
			break;
		default:
			message = l10n.t("GitLens upgraded to {0} — see what's new.", majorVersion);
			break;
	}

	const actions: MessageItem[] = majorVersion === '19' ? [openGraph, releaseNotes] : [releaseNotes];
	if (majorVersion === '18') {
		actions.push(openWalkthrough);
	}
	actions.push(confirm);

	const result = await showMessage('info', message, undefined, null, ...actions);

	if (result === releaseNotes) {
		void openUrl(urls.releaseNotes);
	} else if (result === openWalkthrough) {
		void executeCommand('gitlens.showWelcomeView', { mode: 'graph' });
	} else if (result === openGraph) {
		void executeCommand('gitlens.showGraphView');
	}
}

export async function showMcpMessage(container: Container, _current: string): Promise<void> {
	const isAutoInstallable = container.gkMcp?.isRegistrationAllowed ?? false;
	const confirm = { title: l10n.t('OK'), isCloseAffordance: true };
	const learnMore = { title: l10n.t('Learn More') };
	const connectMore = { title: l10n.t('Connect More Agents') };
	const install = { title: l10n.t('Install GitKraken MCP') };

	let result: MessageItem | undefined;
	if (isAutoInstallable) {
		result = await showMessage(
			'info',
			l10n.t(
				'GitLens adds the GitKraken MCP into your AI chat, leveraging Git and your integrations to provide context and perform actions. You can also connect MCP to other agents on your machine.',
			),
			undefined,
			null,
			connectMore,
			learnMore,
			confirm,
		);
	} else {
		result = await showMessage(
			'info',
			l10n.t(
				'Allow GitLens to add the GitKraken MCP into your AI chat, leveraging Git and your integrations (issues, PRs, etc) to provide context and perform actions. Saving you time and context switching.',
			),
			undefined,
			null,
			install,
			learnMore,
			confirm,
		);
	}

	if (result === install) {
		void executeCommand<Source>('gitlens.ai.mcp.install', { source: 'mcp-welcome-message' });
	}

	if (result === connectMore) {
		void executeCommand<Source>('gitlens.ai.mcp.installForAllAgents', { source: 'mcp-welcome-message' });
	}

	if (result === learnMore) {
		void openUrl(urls.helpCenterMCP);
	}
}

export async function showCursorMcpCleanupMessage(): Promise<void> {
	const learnMore = { title: l10n.t('Learn More') };
	const confirm = { title: l10n.t('OK'), isCloseAffordance: true };

	const result = await showMessage(
		'info',
		l10n.t(
			'GitLens now registers the GitKraken MCP automatically in Cursor. You may have a duplicate entry in your Cursor `mcp.json` — remove `mcpServers.GitKraken` to clean it up.',
		),
		undefined,
		null,
		learnMore,
		confirm,
	);

	if (result === learnMore) {
		void openUrl(urls.helpCenterMCP);
	}
}

export async function showMessage(
	type: 'info' | 'warn' | 'error',
	message: string,
	suppressionKey?: SuppressedMessages,
	dontShowAgain: MessageItem | null = { title: l10n.t("Don't Show Again") },
	...actions: MessageItem[]
): Promise<MessageItem | undefined> {
	Logger.debug(`ShowMessage(${type}, '${message}', ${suppressionKey}, ${JSON.stringify(dontShowAgain)})`);

	if (suppressionKey != null && configuration.get(`advanced.messages.${suppressionKey}` as const)) {
		Logger.debug(`ShowMessage(${type}, '${message}', ${suppressionKey}, ${JSON.stringify(dontShowAgain)}) skipped`);
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
		Logger.debug(
			`ShowMessage(${type}, '${message}', ${suppressionKey}, ${JSON.stringify(
				dontShowAgain,
			)}) don't show again requested`,
		);
		await suppressedMessage(suppressionKey);

		if (result === dontShowAgain) return undefined;
	}

	Logger.debug(
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
			// oxlint-disable-next-line typescript/no-dynamic-delete
			delete messages[key as keyof typeof messages];
		}
	}

	return configuration.update('advanced.messages', messages, ConfigurationTarget.Global);
}
