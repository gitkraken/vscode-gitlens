'use strict';
import { commands, ExtensionContext, extensions, window, workspace } from 'vscode';
import type { CreatePullRequestActionContext, GitLensApi, OpenPullRequestActionContext } from '../src/api/gitlens';
import { Api } from './api/api';
import { Commands, executeCommand, OpenPullRequestOnRemoteCommandArgs, registerCommands } from './commands';
import { CreatePullRequestOnRemoteCommandArgs } from './commands/createPullRequestOnRemote';
import { configuration, Configuration, TraceLevel } from './configuration';
import { ContextKeys, GlobalState, GlyphChars, setContext, SyncedState } from './constants';
import { Container } from './container';
import { Git, GitBranch, GitCommit } from './git/git';
import { GitService } from './git/gitService';
import { GitUri } from './git/gitUri';
import { InvalidGitConfigError, UnableToFindGitError } from './git/locator';
import { Logger } from './logger';
import { Messages } from './messages';
import { registerPartnerActionRunners } from './partners';
import { Strings, Versions } from './system';
import { ViewNode } from './views/nodes';

let _context: ExtensionContext | undefined;

export async function activate(context: ExtensionContext): Promise<GitLensApi | undefined> {
	const start = process.hrtime();

	_context = context;

	if (context.extension.id === 'eamodio.gitlens-insiders') {
		// Ensure that stable isn't also installed
		const stable = extensions.getExtension('eamodio.gitlens');
		if (stable != null) {
			Logger.log('GitLens (Insiders) was NOT activated because GitLens is also enabled');

			// If we don't use a setTimeout here this notification will get lost for some reason
			setTimeout(() => void Messages.showInsidersErrorMessage(), 0);

			return undefined;
		}
	}

	// Pretend we are enabled (until we know otherwise) and set the view contexts to reduce flashing on load
	void setContext(ContextKeys.Enabled, true);

	if (!workspace.isTrusted) {
		void setContext(ContextKeys.Readonly, true);
		context.subscriptions.push(
			workspace.onDidGrantWorkspaceTrust(() => void setContext(ContextKeys.Readonly, undefined)),
		);
	}

	setKeysForSync();

	Logger.configure(context, configuration.get('outputLevel'), o => {
		if (GitUri.is(o)) {
			return `GitUri(${o.toString(true)}${o.repoPath ? ` repoPath=${o.repoPath}` : ''}${
				o.sha ? ` sha=${o.sha}` : ''
			})`;
		}

		if (GitCommit.is(o)) {
			return `GitCommit(${o.sha ? ` sha=${o.sha}` : ''}${o.repoPath ? ` repoPath=${o.repoPath}` : ''})`;
		}

		if (ViewNode.is(o)) {
			return o.toString();
		}

		return undefined;
	});

	const gitlensVersion = context.extension.packageJSON.version;

	const syncedVersion = context.globalState.get<string>(SyncedState.Version);
	const localVersion =
		context.globalState.get<string>(GlobalState.Version) ??
		context.globalState.get<string>(GlobalState.Deprecated_Version);

	let previousVersion;
	if (localVersion == null || syncedVersion == null) {
		previousVersion = syncedVersion ?? localVersion;
	} else if (Versions.compare(syncedVersion, localVersion) === 1) {
		previousVersion = syncedVersion;
	} else {
		previousVersion = localVersion;
	}

	if (Logger.willLog('debug')) {
		Logger.debug(
			`GitLens (v${gitlensVersion}): syncedVersion=${syncedVersion}, localVersion=${localVersion}, previousVersion=${previousVersion}, ${
				SyncedState.WelcomeViewVisible
			}=${context.globalState.get<boolean>(SyncedState.WelcomeViewVisible)}`,
		);
	}

	if (previousVersion == null) {
		void context.globalState.update(SyncedState.WelcomeViewVisible, true);
		void setContext(ContextKeys.ViewsWelcomeVisible, true);
	} else {
		void setContext(
			ContextKeys.ViewsWelcomeVisible,
			context.globalState.get<boolean>(SyncedState.WelcomeViewVisible) ?? false,
		);
	}

	const enabled = workspace.getConfiguration('git', null).get<boolean>('enabled', true);
	if (!enabled) {
		Logger.log(`GitLens (v${gitlensVersion}) was NOT activated -- "git.enabled": false`);
		void setEnabled(false);

		void Messages.showGitDisabledErrorMessage();

		return undefined;
	}

	Configuration.configure(context);

	const cfg = configuration.get();

	// await migrateSettings(context, previousVersion);

	try {
		await GitService.initialize();
	} catch (ex) {
		Logger.error(ex, `GitLens (v${gitlensVersion}) activate`);
		void setEnabled(false);

		if (ex instanceof InvalidGitConfigError) {
			void Messages.showGitInvalidConfigErrorMessage();
		} else if (ex instanceof UnableToFindGitError) {
			void Messages.showGitMissingErrorMessage();
		} else {
			const msg: string = ex?.message ?? '';
			if (msg) {
				void window.showErrorMessage(`Unable to initialize Git; ${msg}`);
			}
		}

		return undefined;
	}

	Container.initialize(context, cfg);

	registerCommands(context);
	registerBuiltInActionRunners(context);
	registerPartnerActionRunners(context);

	const gitVersion = Git.getGitVersion();

	notifyOnUnsupportedGitVersion(gitVersion);
	void showWelcomeOrWhatsNew(context, gitlensVersion, previousVersion);

	void context.globalState.update(GlobalState.Version, gitlensVersion);

	// Only update our synced version if the new version is greater
	if (syncedVersion == null || Versions.compare(gitlensVersion, syncedVersion) === 1) {
		void context.globalState.update(SyncedState.Version, gitlensVersion);
	}

	if (cfg.outputLevel === TraceLevel.Debug) {
		setTimeout(async () => {
			if (cfg.outputLevel !== TraceLevel.Debug) return;

			if (await Messages.showDebugLoggingWarningMessage()) {
				void commands.executeCommand(Commands.DisableDebugLogging);
			}
		}, 60000);
	}

	Logger.log(
		`GitLens (v${gitlensVersion}${cfg.mode.active ? `, mode: ${cfg.mode.active}` : ''}) activated ${
			GlyphChars.Dot
		} ${Strings.getDurationMilliseconds(start)} ms`,
	);

	const api = new Api();
	return api;
}

export function deactivate() {
	// nothing to do
}

// async function migrateSettings(context: ExtensionContext, previousVersion: string | undefined) {
// 	if (previousVersion === undefined) return;

// 	const previous = Versions.fromString(previousVersion);

// 	try {
// 		if (Versions.compare(previous, Versions.from(11, 0, 0)) !== 1) {
// 		}
// 	} catch (ex) {
// 		Logger.error(ex, 'migrateSettings');
// 	}
// }

export async function setEnabled(enabled: boolean): Promise<void> {
	await Promise.all([setContext(ContextKeys.Enabled, enabled), setContext(ContextKeys.Disabled, !enabled)]);
}

export function setKeysForSync(...keys: (SyncedState | string)[]) {
	return _context?.globalState.setKeysForSync([...keys, SyncedState.Version, SyncedState.WelcomeViewVisible]);
}

export function notifyOnUnsupportedGitVersion(version: string) {
	if (GitService.compareGitVersion('2.7.2') !== -1) return;

	// If git is less than v2.7.2
	void Messages.showGitVersionUnsupportedErrorMessage(version, '2.7.2');
}

function registerBuiltInActionRunners(context: ExtensionContext): void {
	context.subscriptions.push(
		Container.actionRunners.registerBuiltIn<CreatePullRequestActionContext>('createPullRequest', {
			label: ctx => `Create Pull Request on ${ctx.remote?.provider?.name ?? 'Remote'}`,
			run: async ctx => {
				if (ctx.type !== 'createPullRequest') return;

				void (await executeCommand<CreatePullRequestOnRemoteCommandArgs>(Commands.CreatePullRequestOnRemote, {
					base: undefined,
					compare: ctx.branch.isRemote
						? GitBranch.getNameWithoutRemote(ctx.branch.name)
						: ctx.branch.upstream
						? GitBranch.getNameWithoutRemote(ctx.branch.upstream)
						: ctx.branch.name,
					remote: ctx.remote?.name ?? '',
					repoPath: ctx.repoPath,
				}));
			},
		}),
		Container.actionRunners.registerBuiltIn<OpenPullRequestActionContext>('openPullRequest', {
			label: ctx => `Open Pull Request on ${ctx.provider?.name ?? 'Remote'}`,
			run: async ctx => {
				if (ctx.type !== 'openPullRequest') return;

				void (await executeCommand<OpenPullRequestOnRemoteCommandArgs>(Commands.OpenPullRequestOnRemote, {
					pr: { url: ctx.pullRequest.url },
				}));
			},
		}),
	);
}

async function showWelcomeOrWhatsNew(context: ExtensionContext, version: string, previousVersion: string | undefined) {
	if (previousVersion == null) {
		Logger.log(`GitLens first-time install; window.focused=${window.state.focused}`);
		if (Container.config.showWelcomeOnInstall === false) return;

		if (window.state.focused) {
			await context.globalState.update(GlobalState.PendingWelcomeOnFocus, undefined);
			await commands.executeCommand(Commands.ShowWelcomePage);
		} else {
			// Save pending on window getting focus
			await context.globalState.update(GlobalState.PendingWelcomeOnFocus, true);
			const disposable = window.onDidChangeWindowState(e => {
				if (!e.focused) return;

				disposable.dispose();

				// If the window is now focused and we are pending the welcome, clear the pending state and show the welcome
				if (context.globalState.get(GlobalState.PendingWelcomeOnFocus) === true) {
					void context.globalState.update(GlobalState.PendingWelcomeOnFocus, undefined);
					if (Container.config.showWelcomeOnInstall) {
						void commands.executeCommand(Commands.ShowWelcomePage);
					}
				}
			});
			context.subscriptions.push(disposable);
		}

		return;
	}

	if (previousVersion !== version) {
		Logger.log(`GitLens upgraded from v${previousVersion} to v${version}; window.focused=${window.state.focused}`);
	}

	const [major, minor] = version.split('.').map(v => parseInt(v, 10));
	const [prevMajor, prevMinor] = previousVersion.split('.').map(v => parseInt(v, 10));
	if (
		(major === prevMajor && minor === prevMinor) ||
		// Don't notify on downgrades
		major < prevMajor ||
		(major === prevMajor && minor < prevMinor)
	) {
		return;
	}

	if (major !== prevMajor && Container.config.showWhatsNewAfterUpgrades) {
		if (window.state.focused) {
			await context.globalState.update(GlobalState.PendingWhatsNewOnFocus, undefined);
			await Messages.showWhatsNewMessage(version);
		} else {
			// Save pending on window getting focus
			await context.globalState.update(GlobalState.PendingWhatsNewOnFocus, true);
			const disposable = window.onDidChangeWindowState(e => {
				if (!e.focused) return;

				disposable.dispose();

				// If the window is now focused and we are pending the what's new, clear the pending state and show the what's new
				if (context.globalState.get(GlobalState.PendingWhatsNewOnFocus) === true) {
					void context.globalState.update(GlobalState.PendingWhatsNewOnFocus, undefined);
					if (Container.config.showWhatsNewAfterUpgrades) {
						void Messages.showWhatsNewMessage(version);
					}
				}
			});
			context.subscriptions.push(disposable);
		}
	}
}
