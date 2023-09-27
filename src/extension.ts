import type { ExtensionContext } from 'vscode';
import { version as codeVersion, env, ExtensionMode, Uri, window, workspace } from 'vscode';
import { hrtime } from '@env/hrtime';
import { isWeb } from '@env/platform';
import { Api } from './api/api';
import type { CreatePullRequestActionContext, GitLensApi, OpenPullRequestActionContext } from './api/gitlens';
import type { CreatePullRequestOnRemoteCommandArgs, OpenPullRequestOnRemoteCommandArgs } from './commands';
import { fromOutputLevel } from './config';
import { Commands, SyncedStorageKeys } from './constants';
import { Container } from './container';
import { isGitUri } from './git/gitUri';
import { getBranchNameWithoutRemote, isBranch } from './git/models/branch';
import { isCommit } from './git/models/commit';
import { isRepository } from './git/models/repository';
import { isTag } from './git/models/tag';
import { showDebugLoggingWarningMessage, showPreReleaseExpiredErrorMessage, showWhatsNewMessage } from './messages';
import { registerPartnerActionRunners } from './partners';
import { executeCommand, registerCommands } from './system/command';
import { configuration, Configuration } from './system/configuration';
import { setContext } from './system/context';
import { setDefaultDateLocales } from './system/date';
import { once } from './system/event';
import { getLoggableName, Logger } from './system/logger';
import { flatten } from './system/object';
import { Stopwatch } from './system/stopwatch';
import { Storage } from './system/storage';
import { compare, fromString, satisfies } from './system/version';
import { isViewNode } from './views/nodes/viewNode';

export async function activate(context: ExtensionContext): Promise<GitLensApi | undefined> {
	const gitlensVersion: string = context.extension.packageJSON.version;
	const prerelease = satisfies(gitlensVersion, '> 2020.0.0');

	const outputLevel = configuration.get('outputLevel');
	Logger.configure(
		{
			name: 'GitLens',
			createChannel: function (name: string) {
				return window.createOutputChannel(name);
			},
			toLoggable: function (o: any) {
				if (isGitUri(o)) {
					return `GitUri(${o.toString(true)}${o.repoPath ? ` repoPath=${o.repoPath}` : ''}${
						o.sha ? ` sha=${o.sha}` : ''
					})`;
				}
				if (o instanceof Uri) return `Uri(${o.toString(true)})`;

				if (isRepository(o) || isBranch(o) || isCommit(o) || isTag(o) || isViewNode(o)) return o.toString();

				if ('uri' in o && o.uri instanceof Uri) {
					return `${
						'name' in o && 'index' in o ? 'WorkspaceFolder' : getLoggableName(o)
					}(uri=${o.uri.toString(true)})`;
				}

				return undefined;
			},
		},
		fromOutputLevel(outputLevel),
		context.extensionMode === ExtensionMode.Development,
	);

	const defaultDateLocale = configuration.get('defaultDateLocale');

	const sw = new Stopwatch(`GitLens${prerelease ? ' (pre-release)' : ''} v${gitlensVersion}`, {
		log: {
			message: ` activating in ${env.appName} (${codeVersion}) on the ${isWeb ? 'web' : 'desktop'}; language='${
				env.language
			}', defaultDateLocale='${defaultDateLocale}' (${env.machineId}|${env.sessionId})`,
			//${context.extensionRuntime !== ExtensionRuntime.Node ? ' in a webworker' : ''}
		},
	});

	// Ensure that this pre-release version hasn't expired
	if (prerelease) {
		const v = fromString(gitlensVersion);
		// Get the build date from the version number
		const date = new Date(v.major, v.minor - 1, Number(v.patch.toString().substring(0, 2)));

		// If the build date is older than 14 days then show the expired error message
		if (date.getTime() < Date.now() - 14 * 24 * 60 * 60 * 1000) {
			sw.stop({
				message: ` was NOT activated because this pre-release version (${gitlensVersion}) has expired`,
			});

			// If we don't use a setTimeout here this notification will get lost for some reason
			setTimeout(showPreReleaseExpiredErrorMessage, 0, gitlensVersion);

			return undefined;
		}
	}

	if (!workspace.isTrusted) {
		void setContext('gitlens:untrusted', true);
	}

	setKeysForSync(context);

	const storage = new Storage(context);
	const syncedVersion = storage.get(prerelease ? 'synced:preVersion' : 'synced:version');
	const localVersion = storage.get(prerelease ? 'preVersion' : 'version');

	let previousVersion: string | undefined;
	if (localVersion == null || syncedVersion == null) {
		previousVersion = syncedVersion ?? localVersion;
	} else if (compare(syncedVersion, localVersion) === 1) {
		previousVersion = syncedVersion;
	} else {
		previousVersion = localVersion;
	}

	let exitMessage;
	if (Logger.enabled('debug')) {
		exitMessage = `syncedVersion=${syncedVersion}, localVersion=${localVersion}, previousVersion=${previousVersion}, welcome=${storage.get(
			'views:welcome:visible',
		)}`;
	}

	if (previousVersion == null) {
		void storage.store('views:welcome:visible', true);
	}

	Configuration.configure(context);

	setDefaultDateLocales(defaultDateLocale ?? env.language);
	context.subscriptions.push(
		configuration.onDidChange(e => {
			if (configuration.changed(e, 'defaultDateLocale')) {
				setDefaultDateLocales(configuration.get('defaultDateLocale') ?? env.language);
			}
		}),
	);

	// await migrateSettings(context, previousVersion);

	const container = Container.create(context, storage, prerelease, gitlensVersion, previousVersion);
	once(container.onReady)(() => {
		context.subscriptions.push(...registerCommands(container));
		registerBuiltInActionRunners(container);
		registerPartnerActionRunners(context);

		if (!workspace.isTrusted) {
			context.subscriptions.push(
				workspace.onDidGrantWorkspaceTrust(() => {
					void setContext('gitlens:untrusted', undefined);
					container.telemetry.setGlobalAttribute('workspace.isTrusted', workspace.isTrusted);
				}),
			);
		}

		void showWelcomeOrWhatsNew(container, gitlensVersion, prerelease, previousVersion);

		void storage.store(prerelease ? 'preVersion' : 'version', gitlensVersion);

		// Only update our synced version if the new version is greater
		if (syncedVersion == null || compare(gitlensVersion, syncedVersion) === 1) {
			void storage.store(prerelease ? 'synced:preVersion' : 'synced:version', gitlensVersion);
		}

		if (outputLevel === 'debug') {
			setTimeout(async () => {
				if (configuration.get('outputLevel') !== 'debug') return;

				if (!container.prereleaseOrDebugging) {
					if (await showDebugLoggingWarningMessage()) {
						void executeCommand(Commands.DisableDebugLogging);
					}
				}
			}, 60000);
		}
	});

	if (container.debugging) {
		// Set context to only show some commands when using the pre-release version or debugging
		void setContext('gitlens:debugging', true);
		void setContext('gitlens:prerelease', true);
	} else if (container.prerelease) {
		// Set context to only show some commands when using the pre-release version
		void setContext('gitlens:prerelease', true);
	}

	// Signal that the container is now ready
	await container.ready();

	// TODO@eamodio do we want to capture any vscode settings that are relevant to GitLens?
	const flatCfg = flatten(configuration.getAll(true), { prefix: 'config', stringify: 'all' });

	container.telemetry.setGlobalAttributes({
		debugging: container.debugging,
		prerelease: prerelease,
		install: previousVersion == null,
		upgrade: previousVersion != null && gitlensVersion !== previousVersion,
		upgradedFrom: previousVersion != null && gitlensVersion !== previousVersion ? previousVersion : undefined,
	});

	const api = new Api(container);
	const mode = container.mode;

	const startTime = sw.startTime;
	const endTime = hrtime();
	const elapsed = sw.elapsed();

	sw.stop({
		message: ` activated${exitMessage != null ? `, ${exitMessage}` : ''}${
			mode != null ? `, mode: ${mode.name}` : ''
		}`,
	});

	container.telemetry.sendEvent(
		'activate',
		{
			'activation.elapsed': elapsed,
			'activation.mode': mode?.name,
			...flatCfg,
		},
		startTime,
		endTime,
	);

	return Promise.resolve(api);
}

export function deactivate() {
	Logger.log('GitLens deactivating...');
	Container.instance.deactivate();
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
	context.globalState?.setKeysForSync([...keys, SyncedStorageKeys.Version, SyncedStorageKeys.HomeViewWelcomeVisible]);
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

async function showWelcomeOrWhatsNew(
	container: Container,
	version: string,
	prerelease: boolean,
	previousVersion: string | undefined,
) {
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

	const current = fromString(version);
	const previous = fromString(previousVersion);

	// Don't notify on downgrades
	if (current.major < previous.major || (current.major === previous.major && current.minor < previous.minor)) {
		return;
	}

	const majorPrerelease = prerelease && satisfies(previous, '< 2023.6.0800');

	if (current.major === previous.major && !majorPrerelease) return;

	version = majorPrerelease ? '14' : String(current.major);

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
