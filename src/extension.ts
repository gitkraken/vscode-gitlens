'use strict';

import { commands, ExtensionContext, extensions, window, workspace } from 'vscode';
import { Commands, configureCommands } from './commands';
import { configuration, Configuration, IConfig } from './configuration';
import { CommandContext, extensionQualifiedId, GlobalState, GlyphChars, setCommandContext } from './constants';
import { Container } from './container';
import { GitService } from './git/gitService';
import { Logger } from './logger';
import { Messages } from './messages';
import { Strings, Versions } from './system';
// import { Telemetry } from './telemetry';

export async function activate(context: ExtensionContext) {
    const start = process.hrtime();

    Logger.configure(context);

    const gitlens = extensions.getExtension(extensionQualifiedId)!;
    const gitlensVersion = gitlens.packageJSON.version;

    const enabled = workspace.getConfiguration('git', null!).get<boolean>('enabled', true);
    if (!enabled) {
        Logger.log(`GitLens(v${gitlensVersion}) was NOT activated -- "git.enabled": false`);
        setCommandContext(CommandContext.Enabled, false);

        void Messages.showGitDisabledErrorMessage();

        return;
    }

    Configuration.configure(context);

    const cfg = configuration.get<IConfig>();

    // Pretend we are enabled (until we know otherwise) and set the explorer contexts to reduce flashing on load
    await Promise.all([
        setCommandContext(CommandContext.Enabled, true),
        setCommandContext(CommandContext.GitExplorer, cfg.gitExplorer.enabled ? cfg.gitExplorer.location : false),
        setCommandContext(
            CommandContext.FileHistoryExplorer,
            cfg.fileHistoryExplorer.enabled ? cfg.fileHistoryExplorer.location : false
        ),
        setCommandContext(
            CommandContext.LineHistoryExplorer,
            cfg.lineHistoryExplorer.enabled ? cfg.lineHistoryExplorer.location : false
        )
    ]);

    const previousVersion = context.globalState.get<string>(GlobalState.GitLensVersion);
    await migrateSettings(context, previousVersion);

    try {
        await GitService.initialize();
    }
    catch (ex) {
        Logger.error(ex, `GitLens(v${gitlensVersion}).activate`);
        setCommandContext(CommandContext.Enabled, false);

        if (ex.message.includes('Unable to find git')) {
            await window.showErrorMessage(
                `GitLens was unable to find Git. Please make sure Git is installed. Also ensure that Git is either in the PATH, or that 'git.path' is pointed to its installed location.`
            );
        }

        return;
    }

    Container.initialize(context, cfg);

    configureCommands();

    const gitVersion = GitService.getGitVersion();

    // Telemetry.configure(ApplicationInsightsKey);

    // const telemetryContext: { [id: string]: any } = Object.create(null);
    // telemetryContext.version = gitlensVersion;
    // telemetryContext['git.version'] = gitVersion;
    // Telemetry.setContext(telemetryContext);

    notifyOnUnsupportedGitVersion(gitVersion);
    void showWelcomePage(gitlensVersion, previousVersion);
    void Messages.showKeyBindingsInfoMessage();

    context.globalState.update(GlobalState.GitLensVersion, gitlensVersion);

    // Constantly over my data cap so stop collecting initialized event
    // Telemetry.trackEvent('initialized', Objects.flatten(cfg, 'config', true));

    Logger.log(`GitLens(v${gitlensVersion}) activated ${GlyphChars.Dot} ${Strings.getDurationMilliseconds(start)} ms`);
}

export function deactivate() {}

async function migrateSettings(context: ExtensionContext, previousVersion: string | undefined) {
    if (previousVersion === undefined) return;

    const previous = Versions.fromString(previousVersion);

    try {
        if (Versions.compare(previous, Versions.from(9, 0, 0)) !== 1) {
            await configuration.migrate(
                'historyExplorer.avatars',
                configuration.name('fileHistoryExplorer')('avatars').value
            );
            await configuration.migrate(
                'historyExplorer.enabled',
                configuration.name('fileHistoryExplorer')('enabled').value
            );
            await configuration.migrate(
                'historyExplorer.location',
                configuration.name('fileHistoryExplorer')('location').value
            );

            await configuration.migrate(
                'historyExplorer.avatars',
                configuration.name('lineHistoryExplorer')('avatars').value
            );
            await configuration.migrate(
                'historyExplorer.enabled',
                configuration.name('lineHistoryExplorer')('enabled').value
            );
            await configuration.migrate(
                'historyExplorer.location',
                configuration.name('lineHistoryExplorer')('location').value
            );
        }
    }
    catch (ex) {
        Logger.error(ex, 'migrateSettings');
    }
}

function notifyOnUnsupportedGitVersion(version: string) {
    if (GitService.compareGitVersion('2.2.0') !== -1) return;

    // If git is less than v2.2.0
    void Messages.showGitVersionUnsupportedErrorMessage(version);
}

async function showWelcomePage(version: string, previousVersion: string | undefined) {
    if (previousVersion === undefined) {
        Logger.log(`GitLens first-time install`);

        if (Container.config.showWhatsNewAfterUpgrades) {
            await commands.executeCommand(Commands.ShowWelcomePage);
        }

        return;
    }

    if (previousVersion !== version) {
        Logger.log(`GitLens upgraded from v${previousVersion} to v${version}`);

        if (Versions.compare(Versions.fromString(previousVersion), Versions.from(8, 0, 0)) === 0) {
            await commands.executeCommand(Commands.ShowWelcomePage);

            return;
        }
    }

    if (!Container.config.showWhatsNewAfterUpgrades) return;

    const [major, minor] = version.split('.');
    const [prevMajor, prevMinor] = previousVersion.split('.');
    if (major === prevMajor && minor === prevMinor) return;
    // Don't notify on downgrades
    if (major < prevMajor || (major === prevMajor && minor < prevMinor)) return;

    await commands.executeCommand(Commands.ShowWelcomePage);
}
