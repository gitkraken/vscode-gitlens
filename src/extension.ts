import type { ExtensionContext } from 'vscode';
import { version as codeVersion, env, extensions, window, workspace } from 'vscode';
import { isWeb } from '@env/platform';
import { Api } from './api/api';
import type { CreatePullRequestActionContext, GitLensApi, OpenPullRequestActionContext } from './api/gitlens';
import type { CreatePullRequestOnRemoteCommandArgs, OpenPullRequestOnRemoteCommandArgs } from './commands';
import { configuration, Configuration, OutputLevel } from './configuration';
import { Commands, ContextKeys, CoreCommands } from './constants';
import { Container } from './container';
import { setContext } from './context';
import { GitUri } from './git/gitUri';
import { GitBranch } from './git/models/branch';
import { GitCommit } from './git/models/commit';
import { Logger, LogLevel } from './logger';
import { showDebugLoggingWarningMessage, showInsidersErrorMessage, showWhatsNewMessage } from './messages';
import { registerPartnerActionRunners } from './partners';
import { StorageKeys, SyncedStorageKeys } from './storage';
import { executeCommand, executeCoreCommand, registerCommands } from './system/command';
import { setDefaultDateLocales } from './system/date';
import { once } from './system/event';
import { Stopwatch } from './system/stopwatch';
import { compare, satisfies } from './system/version';
import { ViewNode } from './views/nodes/viewNode';

export async function activate(context: ExtensionContext): Promise<GitLensApi | undefined> {
	const gitlensVersion = context.extension.packageJSON.version;
	const insiders = context.extension.id === 'eamodio.gitlens-insiders' || satisfies(gitlensVersion, '> 2020.0.0');

	const outputLevel = configuration.get('outputLevel');
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

	// If we are using the separate insiders extension, ensure that stable isn't also installed
	if (context.extension.id === 'eamodio.gitlens-insiders') {
		const stable = extensions.getExtension('eamodio.gitlens');
		if (stable != null) {
			sw.stop({ message: ' was NOT activated because GitLens is also enabled' });

			// If we don't use a setTimeout here this notification will get lost for some reason
			setTimeout(() => void showInsidersErrorMessage(), 0);

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
			SyncedStorageKeys.HomeViewWelcomeVisible,
		)}`;
	}

	if (previousVersion == null) {
		void context.globalState.update(SyncedStorageKeys.HomeViewWelcomeVisible, true);
	}

	Configuration.configure(context);

	setDefaultDateLocales(configuration.get('defaultDateLocale') ?? env.language);
	context.subscriptions.push(
		configuration.onDidChange(e => {
			if (configuration.changed(e, 'defaultDateLocale')) {
				setDefaultDateLocales(configuration.get('defaultDateLocale', undefined, env.language));
			}
		}),
	);

	// await migrateSettings(context, previousVersion);

	const container = Container.create(context, insiders);
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

		if (outputLevel === OutputLevel.Debug) {
			setTimeout(async () => {
				if (configuration.get('outputLevel') !== OutputLevel.Debug) return;

				if (!container.insidersOrDebugging) {
					if (await showDebugLoggingWarningMessage()) {
						void executeCommand(Commands.DisableDebugLogging);
					}
				}
			}, 60000);
		}
	});

	// Signal that the container is now ready
	await container.ready();

	// Set a context to only show some commands when debugging
	if (container.debugging) {
		void setContext(ContextKeys.Debugging, true);
	}

	const mode = container.mode;
	sw.stop({
		message: ` activated${exitMessage != null ? `, ${exitMessage}` : ''}${
			mode != null ? `, mode: ${mode.name}` : ''
		}`,
	});

	setTimeout(() => uninstallDeprecatedAuthentication(), 30000);

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
		SyncedStorageKeys.HomeViewWelcomeVisible,
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

		if (configuration.get('showWelcomeOnInstall') === false) return;

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
					if (configuration.get('showWelcomeOnInstall')) {
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

	// Don't notify on downgrades
	if (major === prevMajor || major < prevMajor || (major === prevMajor && minor < prevMinor)) {
		return;
	}

	if (major !== prevMajor) {
		version = String(major);
	}

	void executeCommand(Commands.ShowHomeView);

	if (configuration.get('showWhatsNewAfterUpgrades')) {
		if (window.state.focused) {
			await container.storage.delete(StorageKeys.PendingWhatsNewOnFocus);
			await showWhatsNewMessage(version);
		} else {
			// Save pending on window getting focus
			await container.storage.store(StorageKeys.PendingWhatsNewOnFocus, true);
			const disposable = window.onDidChangeWindowState(e => {
				if (!e.focused) return;

				disposable.dispose();

				// If the window is now focused and we are pending the what's new, clear the pending state and show the what's new
				if (container.storage.get(StorageKeys.PendingWhatsNewOnFocus) === true) {
					void container.storage.delete(StorageKeys.PendingWhatsNewOnFocus);
					if (configuration.get('showWhatsNewAfterUpgrades')) {
						void showWhatsNewMessage(version);
					}
				}
			});
			container.context.subscriptions.push(disposable);
		}
	}
}

function uninstallDeprecatedAuthentication() {
	if (extensions.getExtension('gitkraken.gitkraken-authentication') == null) return;

	void executeCoreCommand(CoreCommands.UninstallExtension, 'gitkraken.gitkraken-authentication');
}
