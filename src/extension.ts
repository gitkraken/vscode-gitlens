import { version as codeVersion, env, ExtensionContext, extensions, window, workspace } from 'vscode';
import { isWeb } from '@env/platform';
import { Api } from './api/api';
import type { CreatePullRequestActionContext, GitLensApi, OpenPullRequestActionContext } from './api/gitlens';
import type { CreatePullRequestOnRemoteCommandArgs, OpenPullRequestOnRemoteCommandArgs } from './commands';
import { configuration, Configuration, OutputLevel } from './configuration';
import { Commands, ContextKeys } from './constants';
import { Container } from './container';
import { setContext } from './context';
import { GitUri } from './git/gitUri';
import { GitBranch, GitCommit } from './git/models';
import { Logger, LogLevel } from './logger';
import { Messages } from './messages';
import { registerPartnerActionRunners } from './partners';
import { StorageKeys, SyncedStorageKeys } from './storage';
import { executeCommand, registerCommands } from './system/command';
import { once } from './system/event';
import { Stopwatch } from './system/stopwatch';
import { compare } from './system/version';
import { ViewNode } from './views/nodes';

export async function activate(context: ExtensionContext): Promise<GitLensApi | undefined> {
	const insiders = context.extension.id === 'eamodio.gitlens-insiders';
	const gitlensVersion = context.extension.packageJSON.version;

	Logger.configure(context, configuration.get('outputLevel'), o => {
		if (GitUri.is(o)) {
			return `GitUri(${o.toString(true)}${o.repoPath ? ` repoPath=${o.repoPath}` : ''}${
				o.sha ? ` sha=${o.sha}` : ''
			})`;
		}

		if (GitCommit.is(o)) {
			return `GitCommit(${o.sha ? ` sha=${o.sha}` : ''}${o.repoPath ? ` repoPath=${o.repoPath}` : ''})`;
		}

		if (ViewNode.is(o)) return o.toString();

		return undefined;
	});

	const sw = new Stopwatch(`GitLens${insiders ? ' (Insiders)' : ''} v${gitlensVersion}`, {
		log: {
			message: ` activating in ${env.appName}(${codeVersion}) on the ${isWeb ? 'web' : 'desktop'}`,
			//${context.extensionRuntime !== ExtensionRuntime.Node ? ' in a webworker' : ''}
		},
	});

	if (insiders) {
		// Ensure that stable isn't also installed
		const stable = extensions.getExtension('eamodio.gitlens');
		if (stable != null) {
			sw.stop({ message: ' was NOT activated because GitLens is also enabled' });

			// If we don't use a setTimeout here this notification will get lost for some reason
			setTimeout(() => void Messages.showInsidersErrorMessage(), 0);

			return undefined;
		}
	}

	if (!workspace.isTrusted) {
		void setContext(ContextKeys.Untrusted, true);
		context.subscriptions.push(
			workspace.onDidGrantWorkspaceTrust(() => void setContext(ContextKeys.Untrusted, undefined)),
		);
	}

	setKeysForSync(context);

	const syncedVersion = context.globalState.get<string>(SyncedStorageKeys.Version);
	const localVersion =
		context.globalState.get<string>(StorageKeys.Version) ??
		context.globalState.get<string>(StorageKeys.Deprecated_Version);

	let previousVersion: string | undefined;
	if (localVersion == null || syncedVersion == null) {
		previousVersion = syncedVersion ?? localVersion;
	} else if (compare(syncedVersion, localVersion) === 1) {
		previousVersion = syncedVersion;
	} else {
		previousVersion = localVersion;
	}

	let exitMessage;
	if (Logger.enabled(LogLevel.Debug)) {
		exitMessage = `syncedVersion=${syncedVersion}, localVersion=${localVersion}, previousVersion=${previousVersion}, welcome=${context.globalState.get<boolean>(
			SyncedStorageKeys.WelcomeViewVisible,
		)}`;
	}

	if (previousVersion == null) {
		void context.globalState.update(SyncedStorageKeys.WelcomeViewVisible, true);
		void setContext(ContextKeys.ViewsWelcomeVisible, true);
	} else {
		void setContext(
			ContextKeys.ViewsWelcomeVisible,
			context.globalState.get<boolean>(SyncedStorageKeys.WelcomeViewVisible) ?? false,
		);
	}

	Configuration.configure(context);
	const cfg = configuration.get();
	// await migrateSettings(context, previousVersion);

	const container = Container.create(context, cfg);
	once(container.onReady)(() => {
		context.subscriptions.push(...registerCommands(container));
		registerBuiltInActionRunners(container);
		registerPartnerActionRunners(context);

		void showWelcomeOrWhatsNew(container, gitlensVersion, previousVersion);

		void context.globalState.update(StorageKeys.Version, gitlensVersion);

		// Only update our synced version if the new version is greater
		if (syncedVersion == null || compare(gitlensVersion, syncedVersion) === 1) {
			void context.globalState.update(SyncedStorageKeys.Version, gitlensVersion);
		}

		if (cfg.outputLevel === OutputLevel.Debug) {
			setTimeout(async () => {
				if (cfg.outputLevel !== OutputLevel.Debug) return;

				if (!container.insiders) {
					if (await Messages.showDebugLoggingWarningMessage()) {
						void executeCommand(Commands.DisableDebugLogging);
					}
				}
			}, 60000);
		}
	});

	// Signal that the container is now ready
	await container.ready();

	sw.stop({
		message: ` activated${exitMessage != null ? `, ${exitMessage}` : ''}${
			cfg.mode.active ? `, mode: ${cfg.mode.active}` : ''
		}`,
	});

	const api = new Api(container);
	return Promise.resolve(api);
}

export function deactivate() {
	// nothing to do
}

// async function migrateSettings(context: ExtensionContext, previousVersion: string | undefined) {
// 	if (previousVersion === undefined) return;

// 	const previous = fromString(previousVersion);

// 	try {
// 		if (compare(previous, from(11, 0, 0)) !== 1) {
// 		}
// 	} catch (ex) {
// 		Logger.error(ex, 'migrateSettings');
// 	}
// }

function setKeysForSync(context: ExtensionContext, ...keys: (SyncedStorageKeys | string)[]) {
	return context.globalState?.setKeysForSync([
		...keys,
		SyncedStorageKeys.Version,
		SyncedStorageKeys.WelcomeViewVisible,
	]);
}

function registerBuiltInActionRunners(container: Container): void {
	container.context.subscriptions.push(
		container.actionRunners.registerBuiltIn<CreatePullRequestActionContext>('createPullRequest', {
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
		container.actionRunners.registerBuiltIn<OpenPullRequestActionContext>('openPullRequest', {
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

async function showWelcomeOrWhatsNew(container: Container, version: string, previousVersion: string | undefined) {
	if (previousVersion == null) {
		Logger.log(`GitLens first-time install; window.focused=${window.state.focused}`);
		if (container.config.showWelcomeOnInstall === false) return;

		if (window.state.focused) {
			await container.storage.delete(StorageKeys.PendingWelcomeOnFocus);
			await executeCommand(Commands.ShowWelcomePage);
		} else {
			// Save pending on window getting focus
			await container.storage.store(StorageKeys.PendingWelcomeOnFocus, true);
			const disposable = window.onDidChangeWindowState(e => {
				if (!e.focused) return;

				disposable.dispose();

				// If the window is now focused and we are pending the welcome, clear the pending state and show the welcome
				if (container.storage.get(StorageKeys.PendingWelcomeOnFocus) === true) {
					void container.storage.delete(StorageKeys.PendingWelcomeOnFocus);
					if (container.config.showWelcomeOnInstall) {
						void executeCommand(Commands.ShowWelcomePage);
					}
				}
			});
			container.context.subscriptions.push(disposable);
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

	if (major !== prevMajor && container.config.showWhatsNewAfterUpgrades) {
		if (window.state.focused) {
			await container.storage.delete(StorageKeys.PendingWhatsNewOnFocus);
			await Messages.showWhatsNewMessage(version);
		} else {
			// Save pending on window getting focus
			await container.storage.store(StorageKeys.PendingWhatsNewOnFocus, true);
			const disposable = window.onDidChangeWindowState(e => {
				if (!e.focused) return;

				disposable.dispose();

				// If the window is now focused and we are pending the what's new, clear the pending state and show the what's new
				if (container.storage.get(StorageKeys.PendingWhatsNewOnFocus) === true) {
					void container.storage.delete(StorageKeys.PendingWhatsNewOnFocus);
					if (container.config.showWhatsNewAfterUpgrades) {
						void Messages.showWhatsNewMessage(version);
					}
				}
			});
			container.context.subscriptions.push(disposable);
		}
	}
}
