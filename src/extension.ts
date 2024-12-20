import { hrtime } from '@env/hrtime';
import { isWeb } from '@env/platform';
import type { ExtensionContext } from 'vscode';
import { version as codeVersion, env, ExtensionMode, Uri, window, workspace } from 'vscode';
import { Api } from './api/api';
import type { CreatePullRequestActionContext, GitLensApi, OpenPullRequestActionContext } from './api/gitlens';
import type { CreatePullRequestOnRemoteCommandArgs } from './commands/createPullRequestOnRemote';
import type { OpenPullRequestOnRemoteCommandArgs } from './commands/openPullRequestOnRemote';
import { fromOutputLevel } from './config';
import { trackableSchemes } from './constants';
import { GlCommand } from './constants.commands';
import { SyncedStorageKeys } from './constants.storage';
import { Container } from './container';
import { isGitUri } from './git/gitUri';
import { isBranch } from './git/models/branch';
import { getBranchNameWithoutRemote } from './git/models/branch.utils';
import { isCommit } from './git/models/commit';
import { isRepository } from './git/models/repository';
import { setAbbreviatedShaLength } from './git/models/revision.utils';
import { isTag } from './git/models/tag';
import { showDebugLoggingWarningMessage, showPreReleaseExpiredErrorMessage, showWhatsNewMessage } from './messages';
import { registerPartnerActionRunners } from './partners';
import { setDefaultDateLocales } from './system/date';
import { once } from './system/event';
import { BufferedLogChannel, getLoggableName, Logger } from './system/logger';
import { flatten } from './system/object';
import { Stopwatch } from './system/stopwatch';
import { compare, fromString, satisfies } from './system/version';
import { executeCommand, registerCommands } from './system/vscode/command';
import { configuration, Configuration } from './system/vscode/configuration';
import { setContext } from './system/vscode/context';
import { Storage } from './system/vscode/storage';
import { isTextDocument, isTextEditor, isWorkspaceFolder } from './system/vscode/utils';
import { isViewNode } from './views/nodes/abstract/viewNode';
import './commands';

export async function activate(context: ExtensionContext): Promise<GitLensApi | undefined> {
	const gitlensVersion: string = context.extension.packageJSON.version;
	const prerelease = satisfies(gitlensVersion, '> 2020.0.0');

	const defaultDateLocale = configuration.get('defaultDateLocale');
	const logLevel = fromOutputLevel(configuration.get('outputLevel'));
	Logger.configure(
		{
			name: 'GitLens',
			createChannel: function (name: string) {
				const channel = new BufferedLogChannel(window.createOutputChannel(name), 500);
				context.subscriptions.push(channel);

				if (logLevel === 'error' || logLevel === 'warn') {
					channel.appendLine(
						`GitLens${prerelease ? ' (pre-release)' : ''} v${gitlensVersion} activating in ${
							env.appName
						} (${codeVersion}) on the ${isWeb ? 'web' : 'desktop'}; language='${
							env.language
						}', logLevel='${logLevel}', defaultDateLocale='${defaultDateLocale}' (${env.machineId}|${
							env.sessionId
						})`,
					);
					channel.appendLine(
						'To enable debug logging, set `"gitlens.outputLevel": "debug"` or run "GitLens: Enable Debug Logging" from the Command Palette',
					);
				}
				return channel;
			},
			toLoggable: function (o: any) {
				if (isGitUri(o)) {
					return `GitUri(${o.toString(true)}${o.repoPath ? ` repoPath=${o.repoPath}` : ''}${
						o.sha ? ` sha=${o.sha}` : ''
					})`;
				}
				if (o instanceof Uri) return `Uri(${o.toString(true)})`;

				if (isRepository(o) || isBranch(o) || isCommit(o) || isTag(o) || isViewNode(o)) return o.toString();

				if ('rootUri' in o && o.rootUri instanceof Uri) {
					return `ScmRepository(${o.rootUri.toString(true)})`;
				}

				if ('uri' in o && o.uri instanceof Uri) {
					if (isWorkspaceFolder(o)) {
						return `WorkspaceFolder(${o.name}, index=${o.index}, ${o.uri.toString(true)})`;
					}

					if (isTextDocument(o)) {
						return `TextDocument(${o.languageId}, dirty=${o.isDirty}, ${o.uri.toString(true)})`;
					}

					return `${getLoggableName(o)}(${o.uri.toString(true)})`;
				}

				if (isTextEditor(o)) {
					return `TextEditor(${o.viewColumn}, ${o.document.uri.toString(true)} ${o.selections
						?.map(s => `[${s.anchor.line}:${s.anchor.character}-${s.active.line}:${s.active.character}]`)
						.join(',')})`;
				}

				return undefined;
			},
		},
		logLevel,
		context.extensionMode === ExtensionMode.Development,
	);

	const sw = new Stopwatch(`GitLens${prerelease ? ' (pre-release)' : ''} v${gitlensVersion}`, {
		log: {
			message: ` activating in ${env.appName} (${codeVersion}) on the ${isWeb ? 'web' : 'desktop'}; language='${
				env.language
			}', logLevel='${logLevel}', defaultDateLocale='${defaultDateLocale}' (${env.machineId}|${env.sessionId})`,
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

	// If there is no local or synced previous version, this is a new install
	if (localVersion == null || previousVersion == null) {
		void setContext('gitlens:install:new', true);
	} else if (gitlensVersion !== previousVersion && compare(gitlensVersion, previousVersion) === 1) {
		void setContext('gitlens:install:upgradedFrom', previousVersion);
	}

	let exitMessage;
	if (Logger.enabled('debug')) {
		exitMessage = `syncedVersion=${syncedVersion}, localVersion=${localVersion}, previousVersion=${previousVersion}`;
	}

	Configuration.configure(context);

	setDefaultDateLocales(defaultDateLocale ?? env.language);
	context.subscriptions.push(
		configuration.onDidChange(e => {
			if (configuration.changed(e, 'defaultDateLocale')) {
				setDefaultDateLocales(configuration.get('defaultDateLocale') ?? env.language);
			}

			if (configuration.changed(e, 'advanced.abbreviatedShaLength')) {
				setAbbreviatedShaLength(configuration.get('advanced.abbreviatedShaLength'));
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

		void showWhatsNew(container, gitlensVersion, prerelease, previousVersion);

		void storage.store(prerelease ? 'preVersion' : 'version', gitlensVersion).catch();

		// Only update our synced version if the new version is greater
		if (syncedVersion == null || compare(gitlensVersion, syncedVersion) === 1) {
			void storage.store(prerelease ? 'synced:preVersion' : 'synced:version', gitlensVersion).catch();
		}

		if (logLevel === 'debug') {
			setTimeout(async () => {
				if (fromOutputLevel(configuration.get('outputLevel')) !== 'debug') return;

				if (!container.prereleaseOrDebugging) {
					if (await showDebugLoggingWarningMessage()) {
						void executeCommand(GlCommand.DisableDebugLogging);
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
	// NOTE: We might have to add more schemes to this list, because the schemes that are used in the `resource*` context keys don't match was URI scheme is returned in the APIs
	// For example, using the remote extensions the `resourceScheme` is `vscode-remote`, but the URI scheme is `file`
	void setContext('gitlens:schemes:trackable', [...trackableSchemes]);

	// Signal that the container is now ready
	await container.ready();

	// TODO@eamodio do we want to capture any vscode settings that are relevant to GitLens?
	const flatCfg = flatten(configuration.getAll(true), 'config', { joinArrays: true });

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
		message: `activated${exitMessage != null ? `, ${exitMessage}` : ''}${
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
		undefined,
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
	context.globalState?.setKeysForSync([...keys, SyncedStorageKeys.Version, SyncedStorageKeys.PreReleaseVersion]);
}

function registerBuiltInActionRunners(container: Container): void {
	container.context.subscriptions.push(
		container.actionRunners.registerBuiltIn<CreatePullRequestActionContext>('createPullRequest', {
			label: ctx => `Create Pull Request on ${ctx.remote?.provider?.name ?? 'Remote'}`,
			run: async ctx => {
				if (ctx.type !== 'createPullRequest') return;

				void (await executeCommand<CreatePullRequestOnRemoteCommandArgs>(GlCommand.CreatePullRequestOnRemote, {
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

				void (await executeCommand<OpenPullRequestOnRemoteCommandArgs>(GlCommand.OpenPullRequestOnRemote, {
					pr: { url: ctx.pullRequest.url },
				}));
			},
		}),
	);
}

async function showWhatsNew(
	container: Container,
	version: string,
	prerelease: boolean,
	previousVersion: string | undefined,
) {
	if (previousVersion == null) {
		Logger.log(`GitLens first-time install; window.focused=${window.state.focused}`);

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
