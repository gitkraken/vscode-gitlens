import type { ExtensionContext } from 'vscode';
import { version as codeVersion, commands, env, ExtensionMode, LogLevel, Uri, window, workspace } from 'vscode';
import { isWeb } from '@env/platform.js';
import { defaultResolver as envDefaultResolver } from '@env/resolver.js';
import { getBranchNameWithoutRemote } from '@gitlens/git/utils/branch.utils.js';
import { setAbbreviatedShaLength } from '@gitlens/git/utils/revision.utils.js';
import { setDefaultDateLocales } from '@gitlens/utils/date.js';
import { setDefaultResolver } from '@gitlens/utils/decorators/resolver.js';
import { once } from '@gitlens/utils/event.js';
import { microhash } from '@gitlens/utils/hash.js';
import { hrtime } from '@gitlens/utils/hrtime.js';
import { isLoggable } from '@gitlens/utils/loggable.js';
import { getLoggableName, Logger } from '@gitlens/utils/logger.js';
import { flatten } from '@gitlens/utils/object.js';
import { Stopwatch } from '@gitlens/utils/stopwatch.js';
import { compare, fromString, satisfies } from '@gitlens/utils/version.js';
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
import {
	showCursorMcpCleanupMessage,
	showDebugLoggingWarningMessage,
	showMcpMessage,
	showPreReleaseExpiredErrorMessage,
	showWhatsNewMessage,
} from './messages.js';
import { registerPartnerActionRunners } from './partners.js';
import { needsCursorMcpCleanupNotice } from './plus/gk/utils/-webview/mcp.utils.js';
import { settingsMigrations } from './settingsMigrations.js';
import { executeCommand, executeCoreCommand, registerCommands } from './system/-webview/command.js';
import { configuration, Configuration } from './system/-webview/configuration.js';
import { setContext } from './system/-webview/context.js';
import { Storage } from './system/-webview/storage.js';
import { deviceCohortGroup, getExtensionModeLabel } from './system/-webview/vscode.js';
import { isTextDocument } from './system/-webview/vscode/documents.js';
import { isTextEditor } from './system/-webview/vscode/editors.js';
import { isWorkspaceFolder } from './system/-webview/vscode/workspaces.js';
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

				// Use custom toString() if available (covers Repository, Branch, Commit, Tag, Remote, Worktree, ViewNode, Container, etc.)
				if (o.toString !== Object.prototype.toString) {
					return o.toString() as string;
				}

				return undefined;
			},
			hash: microhash,
			// Redact env var maps (e.g. `GitOperationRunOptions.env` carrying SSH_ASKPASS tokens) from debug logs.
			sanitizeKeys: new Set(['env']),
		},
		context.extensionMode === ExtensionMode.Development,
	);

	const sw = new Stopwatch(`GitLens${prerelease ? ' (pre-release)' : ''} v${gitlensVersion}`, {
		log: {
			level: 'info',
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

	// Clear any leftover terminal env-var state from older versions (see #4977). The
	// current code no longer contributes terminal env vars, but VS Code may still have
	// persisted entries cached against the extension id, which keeps surfacing the
	// "terminal needs to be relaunched" warning.
	context.environmentVariableCollection.clear();

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

	setDefaultResolver(envDefaultResolver);
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

	await migrateSettings(storage);

	const container = Container.create(context, storage, prerelease, gitlensVersion, previousVersion);
	once(container.onReady)(() => {
		context.subscriptions.push(...registerCommands(container));
		registerBuiltInActionRunners(container);
		registerPartnerActionRunners(context);

		// Activate the Git Health service so its auto-tier maintenance pass + slowness counters start
		// running (the getter is otherwise lazy). Gated internally on `gitlens.gitOptimizations.enabled`.
		void container.gitHealth;

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
		void applyPendingLegacyViewHiding(container);

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
	setFeatureFlagTelemetryGlobalAttributes(container);

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

/** Consumes the one-shot flag set by the `views.legacy:hidden` migration, hiding Home, Cloud Patches
 *  and Cloud Workspaces for upgraded profiles. Best-effort by design: each hide command acts only
 *  while the container currently holding its view is the active composite of that container's
 *  location (verified — a programmatic call resolves without doing anything otherwise, so command
 *  resolution proves nothing). Views dragged into an inactive container are therefore left alone;
 *  ones dragged into a simultaneously-active location (e.g. an open secondary side bar) may still be
 *  hidden — harmless for the hide's intent either way. */
async function applyPendingLegacyViewHiding(container: Container): Promise<void> {
	if (!container.storage.get('views:pendingLegacyHide')) return;

	try {
		// Ephemeral/automation profiles opt out of onboarding-style UI — don't force-reveal anything there
		if (configuration.get('advanced.skipOnboarding')) {
			Logger.debug('applyPendingLegacyViewHiding: skipped (advanced.skipOnboarding)');
			await container.storage.delete('views:pendingLegacyHide');

			return;
		}

		// Profiles that disabled Plus features may have no Graph to land on (its `when` hangs off
		// `gitlens:plus:disabled`) — Home stays their main surface, so don't hide anything. Read the
		// SETTING, not the context: `gitlens:plus:disabled` is computed debounced-async after ready and
		// cannot be set yet here. The flag stays ARMED (not consumed): if Plus features come back later,
		// the next activation performs the hide.
		if (configuration.get('plusFeatures.enabled', undefined, true) === false) {
			Logger.debug('applyPendingLegacyViewHiding: deferred (plus features disabled)');

			return;
		}

		// Untrusted windows and any open virtual (GitHub) folder keep Cloud Patches/Workspaces
		// `when`-excluded, so their hide commands can never register here — defer (flag stays armed) until
		// a window where they can. The scheme test approximates `gitlens:hasVirtualFolders` (repo-based,
		// set async after discovery — unreadable here); the mismatch fails safe in both directions
		if (!workspace.isTrusted || workspace.workspaceFolders?.some(f => f.uri.scheme === 'vscode-vfs')) {
			Logger.debug('applyPendingLegacyViewHiding: deferred (untrusted or virtual workspace)');

			return;
		}

		// Claim the flag before acting: on a multi-window upgrade every window activates with it armed,
		// and one forced reveal is enough
		await container.storage.delete('views:pendingLegacyHide');

		// The hide commands only act while the GitLens container's composite is materialized (their own
		// metadata: "…if it is visible and the view container it is located in is visible") — verified:
		// without this they resolve as silent no-ops. Focus commands can't materialize it reliably —
		// they open whichever container holds their view (a hand-placed Graph would open that one) and
		// resolve `null` instead of rejecting when the view isn't active. The container command is a
		// TOGGLE, but at activation it only closes when the whole GitLens container was dragged into a
		// currently-focused bottom panel — for a layout that curated, the hides bailing (so the views
		// stay) is the directive-compliant outcome anyway. (In the side bars the already-visible-and-
		// focused case just moves focus to the editor group — harmless, hides still work.) Note the
		// reveal itself resolves the Graph webview (the pane is declared visible and starts expanded) —
		// that cost is inherent to the hide.
		await executeCoreCommand('workbench.view.extension.gitlens');

		// Two passes so a late-resolving `when` can't stall the rest past the reveal (Cloud Patches
		// waits on the org's drafts entitlement): hide whatever is ready now, then poll for stragglers.
		// A `when` that never comes true isn't showing its view anyway — the common case (no drafts
		// entitlement) burns the full budget for it; accepted, this runs voided off the critical path,
		// once per install.
		let remaining: ('home' | 'drafts' | 'workspaces')[] = ['home', 'drafts', 'workspaces'];
		const deadline = Date.now() + 15000;
		while (remaining.length) {
			const cmds = await commands.getCommands(true);
			const pending: typeof remaining = [];
			for (const view of remaining) {
				if (!cmds.includes(`gitlens.views.${view}.removeView`)) {
					pending.push(view);
					continue;
				}

				try {
					await executeCoreCommand(`gitlens.views.${view}.removeView`);
				} catch (ex) {
					Logger.debug(`applyPendingLegacyViewHiding: hiding '${view}' failed (${String(ex)})`);
				}
			}

			remaining = pending;
			if (remaining.length === 0 || Date.now() > deadline) {
				if (remaining.length) {
					Logger.debug(
						`applyPendingLegacyViewHiding: skipped '${remaining.join("', '")}' (never registered)`,
					);
				}
				break;
			}

			await new Promise<void>(resolve => setTimeout(resolve, 1000));
		}

		// Land on the Graph LAST: its focus activates whichever container holds the view, so running it
		// before the hides would deactivate the GitLens composite for anyone who hand-placed the Graph
		// in another side-bar container, silently no-opping every hide. `preserveFocus` keeps the
		// keyboard where it is; resolves as a harmless no-op if the Graph isn't available. Skipped for
		// editor-layout profiles — not to avoid the webview (the reveal above already resolved it), but
		// to avoid un-hiding or expanding a Graph pane they may have deliberately collapsed.
		if (configuration.get('graph.layout') !== 'editor') {
			await executeCoreCommand('gitlens.views.graph.focus', { preserveFocus: true });
		}
	} catch (ex) {
		Logger.error(ex, 'applyPendingLegacyViewHiding');
	}
}

async function migrateSettings(storage: Storage): Promise<void> {
	const applied = new Set(storage.get('settings:migrated'));

	let changed = false;
	for (const migration of settingsMigrations) {
		if (applied.has(migration.id)) continue;

		try {
			await migration.migrate(storage);
			// Mark only on success — leave a failed migration unmarked so it retries next activation
			// (migrations are idempotent).
			applied.add(migration.id);
			changed = true;
		} catch (ex) {
			Logger.error(ex, 'migrateSettings', migration.id);
		}
	}

	if (changed) {
		await storage.store('settings:migrated', [...applied]);
	}
}

function setKeysForSync(context: ExtensionContext, ...keys: (SyncedStorageKeys | string)[]) {
	context.globalState?.setKeysForSync([
		...keys,
		SyncedStorageKeys.ApprovedAvatarRemoteTemplates,
		SyncedStorageKeys.Version,
		SyncedStorageKeys.PreReleaseVersion,
	]);
}

function setFeatureFlagTelemetryGlobalAttributes(container: Container): void {
	const flags = container.featureFlags.getAllFlags();
	if (Object.keys(flags).length === 0) return;

	container.telemetry.setGlobalAttribute(
		'featureFlags',
		JSON.stringify(Object.fromEntries(Object.entries(flags).sort(([a], [b]) => a.localeCompare(b)))),
	);
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
	if (needsCursorMcpCleanupNotice(container)) {
		void showCursorMcpCleanupMessage();
		return;
	}

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
