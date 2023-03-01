import type { ConfigurationChangeEvent, ConfigurationScope, Event, ExtensionContext } from 'vscode';
import { ConfigurationTarget, EventEmitter, workspace } from 'vscode';
import type { Config } from '../config';
import { areEqual } from './object';

const configPrefix = 'gitlens';

interface ConfigurationOverrides {
	get<T extends ConfigPath>(section: T, value: ConfigPathValue<T>): ConfigPathValue<T>;
	getAll(config: Config): Config;
	onChange(e: ConfigurationChangeEvent): ConfigurationChangeEvent;
}

export class Configuration {
	static configure(context: ExtensionContext): void {
		context.subscriptions.push(
			// eslint-disable-next-line @typescript-eslint/no-use-before-define
			workspace.onDidChangeConfiguration(configuration.onConfigurationChanged, configuration),
		);
	}

	private _onDidChange = new EventEmitter<ConfigurationChangeEvent>();
	get onDidChange(): Event<ConfigurationChangeEvent> {
		return this._onDidChange.event;
	}

	private _onDidChangeAny = new EventEmitter<ConfigurationChangeEvent>();
	get onDidChangeAny(): Event<ConfigurationChangeEvent> {
		return this._onDidChangeAny.event;
	}

	private _onWillChange = new EventEmitter<ConfigurationChangeEvent>();
	get onWillChange(): Event<ConfigurationChangeEvent> {
		return this._onWillChange.event;
	}

	private onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (!e.affectsConfiguration(configPrefix)) {
			this._onDidChangeAny.fire(e);

			return;
		}

		this._onWillChange.fire(e);

		if (this._overrides?.onChange != null) {
			e = this._overrides.onChange(e);
		}

		this._onDidChangeAny.fire(e);
		this._onDidChange.fire(e);
	}

	private _overrides: Partial<ConfigurationOverrides> | undefined;

	applyOverrides(overrides: ConfigurationOverrides): void {
		this._overrides = overrides;
	}

	clearOverrides(): void {
		if (this._overrides == null) return;

		// Don't clear the "onChange" override as we need to keep it until the stack unwinds (so the the event propagates with the override)
		this._overrides.get = undefined;
		this._overrides.getAll = undefined;
		queueMicrotask(() => (this._overrides = undefined));
	}

	get<T extends ConfigPath>(section: T, scope?: ConfigurationScope | null): ConfigPathValue<T>;
	get<T extends ConfigPath>(
		section: T,
		scope: ConfigurationScope | null | undefined,
		defaultValue: NonNullable<ConfigPathValue<T>>,
	): NonNullable<ConfigPathValue<T>>;
	get<T extends ConfigPath>(
		section: T,
		scope?: ConfigurationScope | null,
		defaultValue?: NonNullable<ConfigPathValue<T>>,
	): ConfigPathValue<T> {
		const value =
			defaultValue === undefined
				? workspace.getConfiguration(configPrefix, scope).get<ConfigPathValue<T>>(section)!
				: workspace.getConfiguration(configPrefix, scope).get<ConfigPathValue<T>>(section, defaultValue)!;
		return this._overrides?.get == null ? value : this._overrides.get<T>(section, value);
	}

	getAll(skipOverrides?: boolean): Config {
		const config = workspace.getConfiguration().get<Config>(configPrefix)!;
		return skipOverrides || this._overrides?.getAll == null ? config : this._overrides.getAll(config);
	}

	getAny<T>(section: string, scope?: ConfigurationScope | null): T | undefined;
	getAny<T>(section: string, scope: ConfigurationScope | null | undefined, defaultValue: T): T;
	getAny<T>(section: string, scope?: ConfigurationScope | null, defaultValue?: T): T | undefined {
		return defaultValue === undefined
			? workspace.getConfiguration(undefined, scope).get<T>(section)
			: workspace.getConfiguration(undefined, scope).get<T>(section, defaultValue);
	}

	changed<T extends ConfigPath>(
		e: ConfigurationChangeEvent | undefined,
		section: T | T[],
		scope?: ConfigurationScope | null | undefined,
	): boolean {
		if (e == null) return true;

		return Array.isArray(section)
			? section.some(s => e.affectsConfiguration(`${configPrefix}.${s}`, scope!))
			: e.affectsConfiguration(`${configPrefix}.${section}`, scope!);
	}

	inspect<T extends ConfigPath, V extends ConfigPathValue<T>>(section: T, scope?: ConfigurationScope | null) {
		return workspace
			.getConfiguration(configPrefix, scope)
			.inspect<V>(section === undefined ? configPrefix : section);
	}

	inspectAny<T>(section: string, scope?: ConfigurationScope | null) {
		return workspace.getConfiguration(undefined, scope).inspect<T>(section);
	}

	isUnset<T extends ConfigPath>(section: T, scope?: ConfigurationScope | null): boolean {
		const inspect = this.inspect(section, scope)!;
		if (inspect.workspaceFolderValue !== undefined) return false;
		if (inspect.workspaceValue !== undefined) return false;
		if (inspect.globalValue !== undefined) return false;

		return true;
	}

	async migrate<T extends ConfigPath>(
		from: string,
		to: T,
		options: { fallbackValue?: ConfigPathValue<T>; migrationFn?(value: any): ConfigPathValue<T> },
	): Promise<boolean> {
		const inspection = this.inspect(from as any);
		if (inspection === undefined) return false;

		let migrated = false;
		if (inspection.globalValue !== undefined) {
			await this.update(
				to,
				options.migrationFn != null ? options.migrationFn(inspection.globalValue) : inspection.globalValue,
				ConfigurationTarget.Global,
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
				options.migrationFn != null
					? options.migrationFn(inspection.workspaceValue)
					: inspection.workspaceValue,
				ConfigurationTarget.Workspace,
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
				options.migrationFn != null
					? options.migrationFn(inspection.workspaceFolderValue)
					: inspection.workspaceFolderValue,
				ConfigurationTarget.WorkspaceFolder,
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

	async migrateIfMissing<T extends ConfigPath>(
		from: string,
		to: T,
		options: { migrationFn?(value: any): ConfigPathValue<T> },
	): Promise<void> {
		const fromInspection = this.inspect(from as any);
		if (fromInspection === undefined) return;

		const toInspection = this.inspect(to);
		if (fromInspection.globalValue !== undefined) {
			if (toInspection === undefined || toInspection.globalValue === undefined) {
				await this.update(
					to,
					options.migrationFn != null
						? options.migrationFn(fromInspection.globalValue)
						: fromInspection.globalValue,
					ConfigurationTarget.Global,
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
					options.migrationFn != null
						? options.migrationFn(fromInspection.workspaceValue)
						: fromInspection.workspaceValue,
					ConfigurationTarget.Workspace,
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
					options.migrationFn != null
						? options.migrationFn(fromInspection.workspaceFolderValue)
						: fromInspection.workspaceFolderValue,
					ConfigurationTarget.WorkspaceFolder,
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

	matches<T extends ConfigPath>(match: T, section: ConfigPath, value: unknown): value is ConfigPathValue<T> {
		return match === section;
	}

	name<T extends ConfigPath>(section: T): string {
		return section;
	}

	update<T extends ConfigPath>(
		section: T,
		value: ConfigPathValue<T> | undefined,
		target: ConfigurationTarget,
	): Thenable<void> {
		return workspace.getConfiguration(configPrefix).update(section, value, target);
	}

	updateAny(
		section: string,
		value: any,
		target: ConfigurationTarget,
		scope?: ConfigurationScope | null,
	): Thenable<void> {
		return workspace
			.getConfiguration(undefined, target === ConfigurationTarget.Global ? undefined : scope!)
			.update(section, value, target);
	}

	updateEffective<T extends ConfigPath>(section: T, value: ConfigPathValue<T> | undefined): Thenable<void> {
		const inspect = this.inspect(section)!;
		if (inspect.workspaceFolderValue !== undefined) {
			if (value === inspect.workspaceFolderValue) return Promise.resolve(undefined);

			return this.update(section, value, ConfigurationTarget.WorkspaceFolder);
		}

		if (inspect.workspaceValue !== undefined) {
			if (value === inspect.workspaceValue) return Promise.resolve(undefined);

			return this.update(section, value, ConfigurationTarget.Workspace);
		}

		if (inspect.globalValue === value || (inspect.globalValue === undefined && value === inspect.defaultValue)) {
			return Promise.resolve(undefined);
		}

		return this.update(
			section,
			areEqual(value, inspect.defaultValue) ? undefined : value,
			ConfigurationTarget.Global,
		);
	}
}

export const configuration = new Configuration();

type SubPath<T, Key extends keyof T> = Key extends string
	? T[Key] extends Record<string, any>
		?
				| `${Key}.${SubPath<T[Key], Exclude<keyof T[Key], keyof any[]>> & string}`
				| `${Key}.${Exclude<keyof T[Key], keyof any[]> & string}`
		: never
	: never;

export type Path<T> = SubPath<T, keyof T> | keyof T;

export type PathValue<T, P extends Path<T>> = P extends `${infer Key}.${infer Rest}`
	? Key extends keyof T
		? Rest extends Path<T[Key]>
			? PathValue<T[Key], Rest>
			: never
		: never
	: P extends keyof T
	? T[P]
	: never;

export type ConfigPath = Path<Config>;
export type ConfigPathValue<P extends ConfigPath> = PathValue<Config, P>;
