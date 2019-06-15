'use strict';
import { commands, ExtensionContext, extensions, window, workspace } from 'vscode';
import { Commands, registerCommands } from './commands';
import { ModeConfig } from './config';
import { Config, configuration, Configuration } from './configuration';
import { CommandContext, extensionQualifiedId, GlobalState, GlyphChars, setCommandContext } from './constants';
import { Container } from './container';
import { GitCommit, GitService, GitUri } from './git/gitService';
import { Logger, TraceLevel } from './logger';
import { Messages } from './messages';
import { Strings, Versions } from './system';
// import { Telemetry } from './telemetry';

export async function activate(context: ExtensionContext) {
    const start = process.hrtime();

    // Pretend we are enabled (until we know otherwise) and set the view contexts to reduce flashing on load
    setCommandContext(CommandContext.Enabled, true);

    Logger.configure(context, configuration.get<TraceLevel>(configuration.name('outputLevel').value), o => {
        if (GitUri.is(o)) {
            return `GitUri(${o.toString(true)}${o.repoPath ? ` repoPath=${o.repoPath}` : ''}${
                o.sha ? ` sha=${o.sha}` : ''
            })`;
        }

        if (GitCommit.is(o)) {
            return `GitCommit(${o.sha ? ` sha=${o.sha}` : ''}${o.repoPath ? ` repoPath=${o.repoPath}` : ''})`;
        }

        return undefined;
    });

    const gitlens = extensions.getExtension(extensionQualifiedId)!;
    const gitlensVersion = gitlens.packageJSON.version;

    const enabled = workspace.getConfiguration('git', null!).get<boolean>('enabled', true);
    if (!enabled) {
        Logger.log(`GitLens (v${gitlensVersion}) was NOT activated -- "git.enabled": false`);
        setCommandContext(CommandContext.Enabled, false);

        void Messages.showGitDisabledErrorMessage();

        return;
    }

    Configuration.configure(context);

    const cfg = configuration.get<Config>();

    const previousVersion = context.globalState.get<string>(GlobalState.GitLensVersion);
    await migrateSettings(context, previousVersion);

    try {
        await GitService.initialize();
    }
    catch (ex) {
        Logger.error(ex, `GitLens (v${gitlensVersion}) activate`);
        setCommandContext(CommandContext.Enabled, false);

        if (ex.message.includes('Unable to find git')) {
            await window.showErrorMessage(
                "GitLens was unable to find Git. Please make sure Git is installed. Also ensure that Git is either in the PATH, or that 'git.path' is pointed to its installed location."
            );
        }

        return;
    }

    Container.initialize(context, cfg);

    registerCommands(context);

    const gitVersion = GitService.getGitVersion();

    // Telemetry.configure(ApplicationInsightsKey);

    // const telemetryContext: { [id: string]: any } = Object.create(null);
    // telemetryContext.version = gitlensVersion;
    // telemetryContext['git.version'] = gitVersion;
    // Telemetry.setContext(telemetryContext);

    notifyOnUnsupportedGitVersion(gitVersion);
    void showWelcomePage(gitlensVersion, previousVersion);

    context.globalState.update(GlobalState.GitLensVersion, gitlensVersion);

    // Constantly over my data cap so stop collecting initialized event
    // Telemetry.trackEvent('initialized', Objects.flatten(cfg, 'config', true));

    Logger.log(
        `GitLens (v${gitlensVersion}${cfg.mode.active ? `, mode: ${cfg.mode.active}` : ''}) activated ${
            GlyphChars.Dot
        } ${Strings.getDurationMilliseconds(start)} ms`
    );
}

export function deactivate() {
    // nothing to do
}

async function migrateSettings(context: ExtensionContext, previousVersion: string | undefined) {
    if (previousVersion === undefined) return;

    const previous = Versions.fromString(previousVersion);

    try {
        if (Versions.compare(previous, Versions.from(9, 6, 3)) !== 1) {
            const formatMigrationFn = (v: string) => {
                if (v == null || v.length === 0) return v;

                return (
                    v
                        // eslint-disable-next-line no-template-curly-in-string
                        .replace(/\$\{authorAgo\}/g, '${author}, ${ago}')
                        // eslint-disable-next-line no-template-curly-in-string
                        .replace(/\$\{authorAgoOrDate\}/g, '${author}, ${agoOrDate}')
                );
            };

            await Promise.all(
                [
                    configuration.name('blame')('format').value,
                    configuration.name('currentLine')('format').value,
                    configuration.name('hovers')('detailsMarkdownFormat').value,
                    configuration.name('statusBar')('format').value,
                    configuration.name('views')('commitFormat').value,
                    configuration.name('views')('commitDescriptionFormat').value,
                    configuration.name('views')('stashFormat').value,
                    configuration.name('views')('stashDescriptionFormat').value
                ].map(s =>
                    configuration.migrate<string, string>(s, s, {
                        migrationFn: formatMigrationFn
                    })
                )
            );
        }
        else if (Versions.compare(previous, Versions.from(9, 2, 2)) !== 1) {
            await configuration.migrate('views.avatars', configuration.name('views')('compare')('avatars').value);
            await configuration.migrate('views.avatars', configuration.name('views')('repositories')('avatars').value);
            await configuration.migrate('views.avatars', configuration.name('views')('search')('avatars').value);
        }
        else if (Versions.compare(previous, Versions.from(9, 0, 0)) !== 1) {
            await configuration.migrate(
                'gitExplorer.autoRefresh',
                configuration.name('views')('repositories')('autoRefresh').value
            );
            await configuration.migrate(
                'gitExplorer.branches.layout',
                configuration.name('views')('repositories')('branches')('layout').value
            );
            await configuration.migrate(
                'gitExplorer.enabled',
                configuration.name('views')('repositories')('enabled').value
            );
            await configuration.migrate(
                'gitExplorer.files.compact',
                configuration.name('views')('repositories')('files')('compact').value
            );
            await configuration.migrate(
                'gitExplorer.files.layout',
                configuration.name('views')('repositories')('files')('layout').value
            );
            await configuration.migrate(
                'gitExplorer.files.threshold',
                configuration.name('views')('repositories')('files')('threshold').value
            );
            await configuration.migrate(
                'gitExplorer.includeWorkingTree',
                configuration.name('views')('repositories')('includeWorkingTree').value
            );
            await configuration.migrate(
                'gitExplorer.location',
                configuration.name('views')('repositories')('location').value
            );
            await configuration.migrate(
                'gitExplorer.showTrackingBranch',
                configuration.name('views')('repositories')('showTrackingBranch').value
            );

            await configuration.migrate(
                'historyExplorer.avatars',
                configuration.name('views')('fileHistory')('avatars').value
            );
            await configuration.migrate(
                'historyExplorer.enabled',
                configuration.name('views')('fileHistory')('enabled').value
            );
            await configuration.migrate(
                'historyExplorer.location',
                configuration.name('views')('fileHistory')('location').value
            );

            await configuration.migrate(
                'historyExplorer.avatars',
                configuration.name('views')('lineHistory')('avatars').value
            );
            await configuration.migrate(
                'historyExplorer.enabled',
                configuration.name('views')('lineHistory')('enabled').value
            );
            await configuration.migrate(
                'historyExplorer.location',
                configuration.name('views')('lineHistory')('location').value
            );

            await configuration.migrate(
                'resultsExplorer.files.compact',
                configuration.name('views')('compare')('files')('compact').value
            );
            await configuration.migrate(
                'resultsExplorer.files.layout',
                configuration.name('views')('compare')('files')('layout').value
            );
            await configuration.migrate(
                'resultsExplorer.files.threshold',
                configuration.name('views')('compare')('files')('threshold').value
            );
            await configuration.migrate(
                'resultsExplorer.location',
                configuration.name('views')('compare')('location').value
            );

            await configuration.migrate(
                'resultsExplorer.files.compact',
                configuration.name('views')('search')('files')('compact').value
            );
            await configuration.migrate(
                'resultsExplorer.files.layout',
                configuration.name('views')('search')('files')('layout').value
            );
            await configuration.migrate(
                'resultsExplorer.files.threshold',
                configuration.name('views')('search')('files')('threshold').value
            );
            await configuration.migrate(
                'resultsExplorer.location',
                configuration.name('views')('search')('location').value
            );

            await configuration.migrate('explorers.avatars', configuration.name('views')('compare')('avatars').value);
            await configuration.migrate(
                'explorers.avatars',
                configuration.name('views')('repositories')('avatars').value
            );
            await configuration.migrate('explorers.avatars', configuration.name('views')('search')('avatars').value);
            await configuration.migrate(
                'explorers.commitFileFormat',
                configuration.name('views')('commitFileFormat').value
            );
            await configuration.migrate('explorers.commitFormat', configuration.name('views')('commitFormat').value);
            await configuration.migrate(
                'explorers.defaultItemLimit',
                configuration.name('views')('defaultItemLimit').value
            );
            await configuration.migrate(
                'explorers.stashFileFormat',
                configuration.name('views')('stashFileFormat').value
            );
            await configuration.migrate('explorers.stashFormat', configuration.name('views')('stashFormat').value);
            await configuration.migrate(
                'explorers.statusFileFormat',
                configuration.name('views')('statusFileFormat').value
            );

            await configuration.migrate<
                {
                    [key: string]: {
                        name: string;
                        statusBarItemName?: string;
                        description?: string;
                        codeLens?: boolean;
                        currentLine?: boolean;
                        explorers?: boolean;
                        hovers?: boolean;
                        statusBar?: boolean;
                    };
                },
                {
                    [key: string]: ModeConfig;
                }
            >('modes', configuration.name('modes').value, {
                migrationFn: v => {
                    const modes = Object.create(null);

                    for (const k in v) {
                        const { explorers, ...mode } = v[k];
                        modes[k] = { ...mode, views: explorers };
                    }

                    return modes;
                }
            });
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
    try {
        if (previousVersion === undefined) {
            Logger.log('GitLens first-time install');

            if (Container.config.showWhatsNewAfterUpgrades) {
                await commands.executeCommand(Commands.ShowWelcomePage);
            }

            return;
        }

        if (previousVersion !== version) {
            Logger.log(`GitLens upgraded from v${previousVersion} to v${version}`);
        }

        const [major, minor] = version.split('.');
        const [prevMajor, prevMinor] = previousVersion.split('.');
        if (
            (major === prevMajor && minor === prevMinor) ||
            // Don't notify on downgrades
            (major < prevMajor || (major === prevMajor && minor < prevMinor))
        ) {
            return;
        }

        if (Container.config.showWhatsNewAfterUpgrades && major !== prevMajor) {
            await commands.executeCommand(Commands.ShowWelcomePage);
        }
        else {
            await Messages.showWhatsNewMessage(version);
        }
    }
    finally {
        void (await Messages.showSetupViewLayoutMessage(previousVersion));
    }
}
