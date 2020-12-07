'use strict';
import * as paths from 'path';
import { commands, ExtensionContext, extensions, window, workspace } from 'vscode';
import { Api } from './api/api';
import { GitLensApi } from './api/gitlens';
import { Commands, registerCommands } from './commands';
import { configuration, Configuration } from './configuration';
import { ContextKeys, GlobalState, GlyphChars, setContext, SyncedState } from './constants';
import { Container } from './container';
import { Git, GitCommit } from './git/git';
import { GitService } from './git/gitService';
import { GitUri } from './git/gitUri';
import { Logger, TraceLevel } from './logger';
import { Messages } from './messages';
import { Strings, Versions } from './system';
import { ViewNode } from './views/nodes';

let _context: ExtensionContext | undefined;

export async function activate(context: ExtensionContext): Promise<GitLensApi | undefined> {
	const start = process.hrtime();

	_context = context;

	let extensionId = 'eamodio.gitlens';
	if (paths.basename(context.globalStorageUri.fsPath) === 'eamodio.gitlens-insiders') {
		extensionId = 'eamodio.gitlens-insiders';

		// Ensure that stable isn't also installed
		const stable = extensions.getExtension('eamodio.gitlens');
		if (stable != null) {
			Logger.log('GitLens (Insiders) was NOT activated because GitLens is also installed');

			void Messages.showInsidersErrorMessage();

			return undefined;
		}
	}

	// Pretend we are enabled (until we know otherwise) and set the view contexts to reduce flashing on load
	void setContext(ContextKeys.Enabled, true);

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

	const gitlens = extensions.getExtension(extensionId)!;
	const gitlensVersion = gitlens.packageJSON.version;

	const syncedVersion = context.globalState.get<string>(SyncedState.Version);
	const previousVersion =
		context.globalState.get<string>(GlobalState.Version) ??
		context.globalState.get<string>(GlobalState.Deprecated_Version) ??
		syncedVersion;

	if (Logger.level === TraceLevel.Debug || Logger.isDebugging) {
		Logger.debug(
			`GitLens (v${gitlensVersion}): syncedVersion=${syncedVersion}, previousVersion=${previousVersion}, ${
				SyncedState.WelcomeViewVisible
			}=${context.globalState.get<boolean>(SyncedState.WelcomeViewVisible)}, ${
				SyncedState.UpdatesViewVisible
			}=${context.globalState.get<boolean>(SyncedState.UpdatesViewVisible)}`,
		);
	}

	if (previousVersion == null) {
		void context.globalState.update(SyncedState.WelcomeViewVisible, true);
		void setContext(ContextKeys.ViewsWelcomeVisible, true);
		void context.globalState.update(SyncedState.UpdatesViewVisible, false);
		void setContext(ContextKeys.ViewsUpdatesVisible, false);
	} else {
		// Force Updates welcome view, since for some reason it never showed for many users
		if (Versions.compare(previousVersion, Versions.from(11, 0, 5)) !== 1) {
			await context.globalState.update(SyncedState.UpdatesViewVisible, true);
		}

		void setContext(
			ContextKeys.ViewsWelcomeVisible,
			context.globalState.get<boolean>(SyncedState.WelcomeViewVisible) ?? false,
		);
		void setContext(
			ContextKeys.ViewsUpdatesVisible,
			context.globalState.get<boolean>(SyncedState.UpdatesViewVisible) !== false,
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

		const msg: string = ex?.message ?? '';
		if (msg.includes('Unable to find git')) {
			await window.showErrorMessage(
				"GitLens was unable to find Git. Please make sure Git is installed. Also ensure that Git is either in the PATH, or that 'git.path' is pointed to its installed location.",
			);
		}

		return undefined;
	}

	Container.initialize(extensionId, context, cfg);

	registerCommands(context);

	const gitVersion = Git.getGitVersion();

	notifyOnUnsupportedGitVersion(gitVersion);
	void showWelcomeOrWhatsNew(gitlensVersion, previousVersion);

	void context.globalState.update(GlobalState.Version, gitlensVersion);

	// Only update our synced version if the new version is greater
	if (syncedVersion == null || Versions.compare(gitlensVersion, syncedVersion) === 1) {
		void context.globalState.update(SyncedState.Version, gitlensVersion);
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
	return _context?.globalState.setKeysForSync([
		...keys,
		SyncedState.UpdatesViewVisible,
		SyncedState.Version,
		SyncedState.WelcomeViewVisible,
	]);
}

export function notifyOnUnsupportedGitVersion(version: string) {
	if (GitService.compareGitVersion('2.7.2') !== -1) return;

	// If git is less than v2.7.2
	void Messages.showGitVersionUnsupportedErrorMessage(version, '2.7.2');
}

async function showWelcomeOrWhatsNew(version: string, previousVersion: string | undefined) {
	if (previousVersion == null) {
		Logger.log('GitLens first-time install');
		await commands.executeCommand(Commands.ShowWelcomePage);

		return;
	}

	if (previousVersion !== version) {
		Logger.log(`GitLens upgraded from v${previousVersion} to v${version}`);
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
		await Messages.showWhatsNewMessage(version);
	}
}
