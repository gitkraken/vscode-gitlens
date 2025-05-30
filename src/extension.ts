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
import { isGitUri } from './git/gitUri';
import { getBranchNameWithoutRemote } from './git/models/branch';
import { isCommit } from './git/models/commit';
import { Logger, LogLevel } from './logger';
import {
	showDebugLoggingWarningMessage,
	showInsidersErrorMessage,
	showPreReleaseExpiredErrorMessage,
	showWhatsNewMessage,
} from './messages';
import { registerPartnerActionRunners } from './partners';
import { Storage, SyncedStorageKeys } from './storage';
import { executeCommand, executeCoreCommand, registerCommands } from './system/command';
import { setDefaultDateLocales } from './system/date';
import { once } from './system/event';
import { Stopwatch } from './system/stopwatch';
import { compare, fromString, satisfies } from './system/version';
import { isViewNode } from './views/nodes/viewNode';

export async function activate(context: ExtensionContext): Promise<GitLensApi | undefined> {
	const gitlensVersion: string = context.extension.packageJSON.version;
	const insiders = context.extension.id === 'eamodio.gitlens-insiders';
	const prerelease = insiders || satisfies(gitlensVersion, '> 2020.0.0');

	const outputLevel = configuration.get('outputLevel');
	Logger.configure(context, configuration.get('outputLevel'), o => {
		if (isGitUri(o)) {
			return `GitUri(${o.toString(true)}${o.repoPath ? ` repoPath=${o.repoPath}` : ''}${
				o.sha ? ` sha=${o.sha}` : ''
			})`;
		}

		if (isCommit(o)) {
			return `GitCommit(${o.sha ? ` sha=${o.sha}` : ''}${o.repoPath ? ` repoPath=${o.repoPath}` : ''})`;
		}

		if (isViewNode(o)) return o.toString();

		return undefined;
	});

	const sw = new Stopwatch(
		`GitLens${prerelease ? (insiders ? ' (Insiders)' : ' (pre-release)') : ''} v${gitlensVersion}`,
		{
			log: {
				message: ` activating in ${env.appName}(${codeVersion}) on the ${isWeb ? 'web' : 'desktop'}`,
				//${context.extensionRuntime !== ExtensionRuntime.Node ? ' in a webworker' : ''}
			},
		},
	);

	// If we are using the separate insiders extension, ensure that stable isn't also installed
	if (insiders) {
		const stable = extensions.getExtension('eamodio.gitlens');
		if (stable != null) {
			sw.stop({ message: ' was NOT activated because GitLens is also enabled' });

			// If we don't use a setTimeout here this notification will get lost for some reason
			setTimeout(() => void showInsidersErrorMessage(), 0);

			return undefined;
		}
	}

	// Ensure that this pre-release or insiders version hasn't expired
	if (prerelease) {
		const v = fromString(gitlensVersion);
		// Get the build date from the version number
		const date = new Date(v.major, v.minor - 1, Number(v.patch.toString().substring(0, 2)));

		// If the build date is older than 14 days then show the expired error message
		if (date.getTime() < Date.now() - 14 * 24 * 60 * 60 * 1000) {
			sw.stop({
				message: ` was NOT activated because this ${
					insiders ? 'insiders' : 'pre-release'
				} version (${gitlensVersion}) has expired`,
			});

			// If we don't use a setTimeout here this notification will get lost for some reason
			setTimeout(() => void showPreReleaseExpiredErrorMessage(gitlensVersion, insiders), 0);

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

	const storage = new Storage(context);
	const syncedVersion = storage.get(prerelease && !insiders ? 'synced:preVersion' : 'synced:version');
	const localVersion = storage.get(prerelease && !insiders ? 'preVersion' : 'version');

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
		exitMessage = `syncedVersion=${syncedVersion}, localVersion=${localVersion}, previousVersion=${previousVersion}, welcome=${storage.get(
			'views:welcome:visible',
		)}`;
	}

	if (previousVersion == null) {
		void storage.store('views:welcome:visible', true);
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

	const container = Container.create(context, storage, prerelease, gitlensVersion, previousVersion);
	once(container.onReady)(() => {
		context.subscriptions.push(...registerCommands(container));
		registerBuiltInActionRunners(container);
		registerPartnerActionRunners(context);

		void showWelcomeOrWhatsNew(container, gitlensVersion, previousVersion);

		void storage.store(prerelease && !insiders ? 'preVersion' : 'version', gitlensVersion);

		// Only update our synced version if the new version is greater
		if (syncedVersion == null || compare(gitlensVersion, syncedVersion) === 1) {
			void storage.store(prerelease && !insiders ? 'synced:preVersion' : 'synced:version', gitlensVersion);
		}

		if (outputLevel === OutputLevel.Debug) {
			setTimeout(async () => {
				if (configuration.get('outputLevel') !== OutputLevel.Debug) return;

				if (!container.prereleaseOrDebugging) {
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
	Logger.log('GitLens deactivated');
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
						? getBranchNameWithoutRemote(ctx.branch.name)
						: ctx.branch.upstream
						? getBranchNameWithoutRemote(ctx.branch.upstream)
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
			await container.storage.delete('pendingWelcomeOnFocus');
			await executeCommand(Commands.ShowWelcomePage);
		} else {
			// Save pending on window getting focus
			await container.storage.store('pendingWelcomeOnFocus', true);
			const disposable = window.onDidChangeWindowState(e => {
				if (!e.focused) return;

				disposable.dispose();

				// If the window is now focused and we are pending the welcome, clear the pending state and show the welcome
				if (container.storage.get('pendingWelcomeOnFocus') === true) {
					void container.storage.delete('pendingWelcomeOnFocus');
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
			await container.storage.delete('pendingWhatsNewOnFocus');
			await showWhatsNewMessage(version);
		} else {
			// Save pending on window getting focus
			await container.storage.store('pendingWhatsNewOnFocus', true);
			const disposable = window.onDidChangeWindowState(e => {
				if (!e.focused) return;

				disposable.dispose();

				// If the window is now focused and we are pending the what's new, clear the pending state and show the what's new
				if (container.storage.get('pendingWhatsNewOnFocus') === true) {
					void container.storage.delete('pendingWhatsNewOnFocus');
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
