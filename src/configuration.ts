'use strict';
export * from './config';

import {
    ConfigurationChangeEvent,
    ConfigurationTarget,
    Event,
    EventEmitter,
    ExtensionContext,
    Uri,
    workspace
} from 'vscode';
import { Config } from './config';
import { extensionId } from './constants';
import { Functions } from './system';

// eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
const emptyConfig: Config = new Proxy<Config>({} as Config, {
    get: function() {
        return emptyConfig;
    }
});

export interface ConfigurationWillChangeEvent {
    change: ConfigurationChangeEvent;
    transform?(e: ConfigurationChangeEvent): ConfigurationChangeEvent;
}

export class Configuration {
    static configure(context: ExtensionContext) {
        context.subscriptions.push(
            workspace.onDidChangeConfiguration(configuration.onConfigurationChanged, configuration)
        );
    }

    private _onDidChange = new EventEmitter<ConfigurationChangeEvent>();
    get onDidChange(): Event<ConfigurationChangeEvent> {
        return this._onDidChange.event;
    }

    private _onDidChangeAny = new EventEmitter<ConfigurationChangeEvent>();
    get onDidChangeAny(): Event<ConfigurationChangeEvent> {
        return this._onDidChange.event;
    }

    private _onWillChange = new EventEmitter<ConfigurationWillChangeEvent>();
    get onWillChange(): Event<ConfigurationWillChangeEvent> {
        return this._onWillChange.event;
    }

    private onConfigurationChanged(e: ConfigurationChangeEvent) {
        if (!e.affectsConfiguration(extensionId, null!)) {
            this._onDidChangeAny.fire(e);

            return;
        }

        const evt: ConfigurationWillChangeEvent = {
            change: e
        };
        this._onWillChange.fire(evt);

        if (evt.transform !== undefined) {
            e = evt.transform(e);
        }

        this._onDidChange.fire(e);
    }

    readonly initializingChangeEvent: ConfigurationChangeEvent = {
        affectsConfiguration: (section: string, resource?: Uri) => true
    };

    get<T>(section?: string, resource?: Uri | null, defaultValue?: T): T {
        return defaultValue === undefined
            ? workspace
                  .getConfiguration(section === undefined ? undefined : extensionId, resource!)
                  .get<T>(section === undefined ? extensionId : section)!
            : workspace
                  .getConfiguration(section === undefined ? undefined : extensionId, resource!)
                  .get<T>(section === undefined ? extensionId : section, defaultValue)!;
    }

    getAny<T>(section: string, resource?: Uri | null, defaultValue?: T) {
        return defaultValue === undefined
            ? workspace.getConfiguration(undefined, resource!).get<T>(section)!
            : workspace.getConfiguration(undefined, resource!).get<T>(section, defaultValue)!;
    }

    changed(e: ConfigurationChangeEvent, section: string, resource?: Uri | null) {
        return e.affectsConfiguration(`${extensionId}.${section}`, resource!);
    }

    initializing(e: ConfigurationChangeEvent) {
        return e === this.initializingChangeEvent;
    }

    inspect(section?: string, resource?: Uri | null) {
        return workspace
            .getConfiguration(section === undefined ? undefined : extensionId, resource!)
            .inspect(section === undefined ? extensionId : section);
    }

    inspectAny(section: string, resource?: Uri | null) {
        return workspace.getConfiguration(undefined, resource!).inspect(section);
    }

    async migrate<TFrom, TTo>(
        from: string,
        to: string,
        options: { fallbackValue?: TTo; migrationFn?(value: TFrom): TTo } = {}
    ): Promise<boolean> {
        const inspection = configuration.inspect(from);
        if (inspection === undefined) return false;

        let migrated = false;
        if (inspection.globalValue !== undefined) {
            await this.update(
                to,
                options.migrationFn ? options.migrationFn(inspection.globalValue as TFrom) : inspection.globalValue,
                ConfigurationTarget.Global
            );
            migrated = true;
            // Can't delete the old setting currently because it errors with `Unable to write to User Settings because <setting name> is not a registered configuration`
            // if (from !== to) {
            //     try {
            //         await this.update(from, undefined, ConfigurationTarget.Global);
            //     }
            //     catch { }
            // }
        }

        if (inspection.workspaceValue !== undefined) {
            await this.update(
                to,
                options.migrationFn
                    ? options.migrationFn(inspection.workspaceValue as TFrom)
                    : inspection.workspaceValue,
                ConfigurationTarget.Workspace
            );
            migrated = true;
            // Can't delete the old setting currently because it errors with `Unable to write to User Settings because <setting name> is not a registered configuration`
            // if (from !== to) {
            //     try {
            //         await this.update(from, undefined, ConfigurationTarget.Workspace);
            //     }
            //     catch { }
            // }
        }

        if (inspection.workspaceFolderValue !== undefined) {
            await this.update(
                to,
                options.migrationFn
                    ? options.migrationFn(inspection.workspaceFolderValue as TFrom)
                    : inspection.workspaceFolderValue,
                ConfigurationTarget.WorkspaceFolder
            );
            migrated = true;
            // Can't delete the old setting currently because it errors with `Unable to write to User Settings because <setting name> is not a registered configuration`
            // if (from !== to) {
            //     try {
            //         await this.update(from, undefined, ConfigurationTarget.WorkspaceFolder);
            //     }
            //     catch { }
            // }
        }

        if (!migrated && options.fallbackValue !== undefined) {
            await this.update(to, options.fallbackValue, ConfigurationTarget.Global);
            migrated = true;
        }

        return migrated;
    }

    async migrateIfMissing<TFrom, TTo>(from: string, to: string, options: { migrationFn?(value: TFrom): TTo } = {}) {
        const fromInspection = configuration.inspect(from);
        if (fromInspection === undefined) return;

        const toInspection = configuration.inspect(to);
        if (fromInspection.globalValue !== undefined) {
            if (toInspection === undefined || toInspection.globalValue === undefined) {
                await this.update(
                    to,
                    options.migrationFn
                        ? options.migrationFn(fromInspection.globalValue as TFrom)
                        : fromInspection.globalValue,
                    ConfigurationTarget.Global
                );
                // Can't delete the old setting currently because it errors with `Unable to write to User Settings because <setting name> is not a registered configuration`
                // if (from !== to) {
                //     try {
                //         await this.update(from, undefined, ConfigurationTarget.Global);
                //     }
                //     catch { }
                // }
            }
        }

        if (fromInspection.workspaceValue !== undefined) {
            if (toInspection === undefined || toInspection.workspaceValue === undefined) {
                await this.update(
                    to,
                    options.migrationFn
                        ? options.migrationFn(fromInspection.workspaceValue as TFrom)
                        : fromInspection.workspaceValue,
                    ConfigurationTarget.Workspace
                );
                // Can't delete the old setting currently because it errors with `Unable to write to User Settings because <setting name> is not a registered configuration`
                // if (from !== to) {
                //     try {
                //         await this.update(from, undefined, ConfigurationTarget.Workspace);
                //     }
                //     catch { }
                // }
            }
        }

        if (fromInspection.workspaceFolderValue !== undefined) {
            if (toInspection === undefined || toInspection.workspaceFolderValue === undefined) {
                await this.update(
                    to,
                    options.migrationFn
                        ? options.migrationFn(fromInspection.workspaceFolderValue as TFrom)
                        : fromInspection.workspaceFolderValue,
                    ConfigurationTarget.WorkspaceFolder
                );
                // Can't delete the old setting currently because it errors with `Unable to write to User Settings because <setting name> is not a registered configuration`
                // if (from !== to) {
                //     try {
                //         await this.update(from, undefined, ConfigurationTarget.WorkspaceFolder);
                //     }
                //     catch { }
                // }
            }
        }
    }

    name<K extends keyof Config>(name: K) {
        return Functions.propOf(emptyConfig as Config, name);
    }

    update(section: string, value: any, target: ConfigurationTarget, resource?: Uri | null) {
        return workspace
            .getConfiguration(extensionId, target === ConfigurationTarget.Global ? undefined : resource!)
            .update(section, value, target);
    }

    updateAny(section: string, value: any, target: ConfigurationTarget, resource?: Uri | null) {
        return workspace
            .getConfiguration(undefined, target === ConfigurationTarget.Global ? undefined : resource!)
            .update(section, value, target);
    }

    async updateEffective(section: string, value: any, resource: Uri | null = null) {
        const inspect = await configuration.inspect(section, resource)!;
        if (inspect.workspaceFolderValue !== undefined) {
            if (value === inspect.workspaceFolderValue) return undefined;

            return void configuration.update(section, value, ConfigurationTarget.WorkspaceFolder, resource);
        }

        if (inspect.workspaceValue !== undefined) {
            if (value === inspect.workspaceValue) return undefined;

            return void configuration.update(section, value, ConfigurationTarget.Workspace);
        }

        if (inspect.globalValue === value || (inspect.globalValue === undefined && value === inspect.defaultValue)) {
            return undefined;
        }

        return void configuration.update(
            section,
            value === inspect.defaultValue ? undefined : value,
            ConfigurationTarget.Global
        );
    }
}

export const configuration = new Configuration();
