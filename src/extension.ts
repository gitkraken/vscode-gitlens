import type { ExtensionContext } from 'vscode';
import { version as codeVersion, env, ExtensionMode, LogLevel, Uri, window, workspace } from 'vscode';
import { hrtime } from '@env/hrtime.js';
import { isWeb } from '@env/platform.js';
import { Api } from './api/api.js';
import type {
	CreatePullRequestActionContext,
	GitLensApi,
	OpenIssueActionContext,
	OpenPullRequestActionContext,
} from './api/gitlens.d.js';
import type { CreatePullRequestOnRemoteCommandArgs } from './commands/createPullRequestOnRemote.js';
import type { OpenIssueOnRemoteCommandArgs } from './commands/openIssueOnRemote.js';
import type { OpenPullRequestOnRemoteCommandArgs } from './commands/openPullRequestOnRemote.js';
import { trackableSchemes } from './constants.js';
import { SyncedStorageKeys } from './constants.storage.js';
import { Container } from './container.js';
import { isGitUri } from './git/gitUri.js';
import { getBranchNameWithoutRemote } from './git/utils/branch.utils.js';
import { setAbbreviatedShaLength } from './git/utils/revision.utils.js';
import {
	showDebugLoggingWarningMessage,
	showMcpMessage,
	showPreReleaseExpiredErrorMessage,
	showWhatsNewMessage,
} from './messages.js';
import { registerPartnerActionRunners } from './partners.js';
import { executeCommand, registerCommands } from './system/-webview/command.js';
import { configuration, Configuration } from './system/-webview/configuration.js';
import { setContext } from './system/-webview/context.js';
import { Storage } from './system/-webview/storage.js';
import { isTextDocument } from './system/-webview/vscode/documents.js';
import { isTextEditor } from './system/-webview/vscode/editors.js';
import { isWorkspaceFolder } from './system/-webview/vscode/workspaces.js';
import { deviceCohortGroup, getExtensionModeLabel } from './system/-webview/vscode.js';
import { setDefaultDateLocales } from './system/date.js';
import { once } from './system/event.js';
import { fnv1aHash } from './system/hash.js';
import { isLoggable } from './system/loggable.js';
import { getLoggableName, Logger } from './system/logger.js';
import { flatten } from './system/object.js';
import { Stopwatch } from './system/stopwatch.js';
import { compare, fromString, satisfies } from './system/version.js';
import './commands.js';

export async function activate(context: ExtensionContext): Promise<GitLensApi | undefined> {
	const gitlensVersion: string = context.extension.packageJSON.version;
	const prerelease = satisfies(gitlensVersion, '> 2020.0.0');

	const defaultDateLocale = configuration.get('defaultDateLocale');
	Logger.configure(
		{
			name: 'GitLens',
			createChannel: function (name: string) {
				const channel = window.createOutputChannel(name, { log: true });
				context.subscriptions.push(channel);

				// Show message if debug logging is not enabled (level > Debug)
				if (channel.logLevel === LogLevel.Off || channel.logLevel > LogLevel.Debug) {
					channel.appendLine(
						'To enable debug logging, run "GitLens: Enable Debug Logging" or "Developer: Set Log Level..." from the Command Palette',
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
				if (isLoggable(o)) return o.toLoggable();

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
			hash: function (data: string) {
				return (fnv1aHash(data) >>> 0).toString(16).padStart(8, '0').slice(0, 4);
			},
		},
		context.extensionMode === ExtensionMode.Development,
	);

	const sw = new Stopwatch(`GitLens${prerelease ? ' (pre-release)' : ''} v${gitlensVersion}`, {
		log: {
			level: 'error',
			message: ` activating in ${env.appName} (${codeVersion}) on the ${isWeb ? 'web' : 'desktop'}; mode=${getExtensionModeLabel(
				context.extensionMode,
			)},language='${
				env.language
			}', logLevel='${Logger.logLevel}', defaultDateLocale='${defaultDateLocale}' (${env.uriScheme}|${env.machineId}|${
				env.sessionId
			})`,
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
	if (Logger.enabled('trace')) {
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
		showMcp(container, gitlensVersion, previousVersion);

		void storage.store(prerelease ? 'preVersion' : 'version', gitlensVersion).catch();

		// Only update our synced version if the new version is greater
		if (syncedVersion == null || compare(gitlensVersion, syncedVersion) === 1) {
			void storage.store(prerelease ? 'synced:preVersion' : 'synced:version', gitlensVersion).catch();
		}

		if (Logger.enabled('trace')) {
			setTimeout(async () => {
				if (!Logger.enabled('trace')) return;

				if (!container.prereleaseOrDebugging) {
					if (await showDebugLoggingWarningMessage()) {
						void executeCommand('gitlens.disableDebugLogging');
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
		'device.cohort': deviceCohortGroup,
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

export function deactivate(): void {
	Logger.info('GitLens deactivating...');
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

				void (await executeCommand<CreatePullRequestOnRemoteCommandArgs>('gitlens.createPullRequestOnRemote', {
					base: undefined,
					compare: ctx.branch.isRemote
						? getBranchNameWithoutRemote(ctx.branch.name)
						: ctx.branch.upstream
							? getBranchNameWithoutRemote(ctx.branch.upstream)
							: ctx.branch.name,
					remote: ctx.remote?.name ?? '',
					repoPath: ctx.repoPath,
					describeWithAI: ctx.describeWithAI,
					source: ctx.source,
				}));
			},
		}),
		container.actionRunners.registerBuiltIn<OpenPullRequestActionContext>('openPullRequest', {
			label: ctx => `Open Pull Request on ${ctx.provider?.name ?? 'Remote'}`,
			run: async ctx => {
				if (ctx.type !== 'openPullRequest') return;

				void (await executeCommand<OpenPullRequestOnRemoteCommandArgs>('gitlens.openPullRequestOnRemote', {
					pr: { url: ctx.pullRequest.url },
				}));
			},
		}),
		container.actionRunners.registerBuiltIn<OpenIssueActionContext>('openIssue', {
			label: ctx => `Open Issue on ${ctx.provider?.name ?? 'Remote'}`,
			run: async ctx => {
				if (ctx.type !== 'openIssue') return;

				void (await executeCommand<OpenIssueOnRemoteCommandArgs>('gitlens.openIssueOnRemote', {
					issue: { url: ctx.issue.url },
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
		Logger.info(`GitLens first-time install; window.focused=${window.state.focused}`);

		return;
	}

	if (previousVersion !== version) {
		Logger.info(`GitLens upgraded from v${previousVersion} to v${version}; window.focused=${window.state.focused}`);
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

function showMcp(container: Container, version: string, previousVersion: string | undefined): void {
	if (
		isWeb ||
		previousVersion == null ||
		version === previousVersion ||
		compare(version, previousVersion) !== 1 ||
		satisfies(fromString(previousVersion), '>= 17.5')
	) {
		return;
	}

	void showMcpMessage(container, version);
}
