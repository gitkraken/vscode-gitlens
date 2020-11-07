'use strict';
import { commands, ExtensionContext, extensions, window, workspace } from 'vscode';
import { Commands, registerCommands } from './commands';
import { configuration, Configuration } from './configuration';
import { ContextKeys, extensionQualifiedId, GlobalState, GlyphChars, setContext } from './constants';
import { Container } from './container';
import { Git, GitCommit } from './git/git';
import { GitService } from './git/gitService';
import { GitUri } from './git/gitUri';
import { Logger } from './logger';
import { Messages } from './messages';
import { Strings } from './system';
import { ViewNode } from './views/nodes';

export async function activate(context: ExtensionContext) {
	const start = process.hrtime();

	// Pretend we are enabled (until we know otherwise) and set the view contexts to reduce flashing on load
	void setContext(ContextKeys.Enabled, true);

	const previousVersion = context.globalState.get<string>(GlobalState.Version);

	if (previousVersion == null) {
		void context.globalState.update(GlobalState.WelcomeViewVisible, true);
		void setContext(ContextKeys.ViewsWelcomeVisible, true);
		void setContext(ContextKeys.ViewsUpdatesVisible, false);
	} else {
		void setContext(
			ContextKeys.ViewsWelcomeVisible,
			context.globalState.get(GlobalState.WelcomeViewVisible) ?? false,
		);
		void setContext(
			ContextKeys.ViewsUpdatesVisible,
			context.globalState.get(GlobalState.UpdatesViewVisible) !== false,
		);
	}

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

	const gitlens = extensions.getExtension(extensionQualifiedId)!;
	const gitlensVersion = gitlens.packageJSON.version;

	const enabled = workspace.getConfiguration('git', null).get<boolean>('enabled', true);
	if (!enabled) {
		Logger.log(`GitLens (v${gitlensVersion}) was NOT activated -- "git.enabled": false`);
		void setEnabled(false);

		void Messages.showGitDisabledErrorMessage();

		return;
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

		return;
	}

	Container.initialize(context, cfg);

	registerCommands(context);

	const gitVersion = Git.getGitVersion();

	notifyOnUnsupportedGitVersion(gitVersion);
	void showWelcomeOrWhatsNew(gitlensVersion, previousVersion);

	void context.globalState.update(GlobalState.Version, gitlensVersion);

	Logger.log(
		`GitLens (v${gitlensVersion}${cfg.mode.active ? `, mode: ${cfg.mode.active}` : ''}) activated ${
			GlyphChars.Dot
		} ${Strings.getDurationMilliseconds(start)} ms`,
	);
}

export function deactivate() {
	// nothing to do
}

export async function setEnabled(enabled: boolean): Promise<void> {
	await Promise.all([setContext(ContextKeys.Enabled, enabled), setContext(ContextKeys.Disabled, !enabled)]);
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

function notifyOnUnsupportedGitVersion(version: string) {
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
