import type { ConfigurationChangeEvent, ConfigurationScope, Event, ExtensionContext } from 'vscode';
import { ConfigurationTarget, EventEmitter, workspace } from 'vscode';
import type { Config, CoreConfig } from '../../config';
import { extensionPrefix } from '../../constants';
import { areEqual } from '../object';

interface ConfigurationOverrides {
	get<T extends ConfigPath>(section: T, value: ConfigPathValue<T>): ConfigPathValue<T>;
	getAll(config: Config): Config;
	onDidChange(e: ConfigurationChangeEvent): ConfigurationChangeEvent;
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

	private onConfigurationChanged(e: ConfigurationChangeEvent) {
		this._onDidChangeAny.fire(e);
		if (!e.affectsConfiguration(extensionPrefix)) return;

		if (this._overrides?.onDidChange != null) {
			e = this._overrides.onDidChange(e);
		}

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

	get<S extends ConfigPath>(section: S, scope?: ConfigurationScope | null): ConfigPathValue<S>;
	get<S extends ConfigPath>(
		section: S,
		scope: ConfigurationScope | null | undefined,
		defaultValue: NonNullable<ConfigPathValue<S>>,
		skipOverrides?: boolean,
	): NonNullable<ConfigPathValue<S>>;
	get<S extends ConfigPath>(
		section: S,
		scope?: ConfigurationScope | null,
		defaultValue?: NonNullable<ConfigPathValue<S>>,
		skipOverrides?: boolean,
	): ConfigPathValue<S> {
		const value =
			defaultValue === undefined
				? workspace.getConfiguration(extensionPrefix, scope).get<ConfigPathValue<S>>(section)!
				: workspace.getConfiguration(extensionPrefix, scope).get<ConfigPathValue<S>>(section, defaultValue)!;
		return skipOverrides || this._overrides?.get == null ? value : this._overrides.get<S>(section, value);
	}

	getAll(skipOverrides?: boolean): Config {
		const config = workspace.getConfiguration().get<Config>(extensionPrefix)!;
		return skipOverrides || this._overrides?.getAll == null ? config : this._overrides.getAll(config);
	}

	getAny<S extends string, T>(section: S, scope?: ConfigurationScope | null): T | undefined;
	getAny<S extends string, T>(section: S, scope: ConfigurationScope | null | undefined, defaultValue: T): T;
	getAny<S extends string, T>(section: S, scope?: ConfigurationScope | null, defaultValue?: T): T | undefined {
		return defaultValue === undefined
			? workspace.getConfiguration(undefined, scope).get<T>(section)
			: workspace.getConfiguration(undefined, scope).get<T>(section, defaultValue);
	}

	getCore<S extends CoreConfigPath>(
		section: S,
		scope?: ConfigurationScope | null,
	): CoreConfigPathValue<S> | undefined;
	getCore<S extends CoreConfigPath>(
		section: S,
		scope: ConfigurationScope | null | undefined,
		defaultValue: CoreConfigPathValue<S>,
	): CoreConfigPathValue<S>;
	getCore<S extends CoreConfigPath>(
		section: S,
		scope?: ConfigurationScope | null,
		defaultValue?: CoreConfigPathValue<S>,
	): CoreConfigPathValue<S> | undefined {
		return defaultValue === undefined
			? workspace.getConfiguration(undefined, scope).get<CoreConfigPathValue<S>>(section)
			: workspace.getConfiguration(undefined, scope).get<CoreConfigPathValue<S>>(section, defaultValue);
	}

	changed<S extends ConfigPath>(
		e: ConfigurationChangeEvent | undefined,
		section: S | S[],
		scope?: ConfigurationScope | null | undefined,
	): boolean {
		if (e == null) return true;

		return Array.isArray(section)
			? section.some(s => e.affectsConfiguration(`${extensionPrefix}.${s}`, scope!))
			: e.affectsConfiguration(`${extensionPrefix}.${section}`, scope!);
	}

	changedAny<S extends string>(
		e: ConfigurationChangeEvent | undefined,
		section: S | S[],
		scope?: ConfigurationScope | null | undefined,
	): boolean {
		if (e == null) return true;

		return Array.isArray(section)
			? section.some(s => e.affectsConfiguration(s, scope!))
			: e.affectsConfiguration(section, scope!);
	}

	changedCore<S extends CoreConfigPath>(
		e: ConfigurationChangeEvent | undefined,
		section: S | S[],
		scope?: ConfigurationScope | null | undefined,
	): boolean {
		if (e == null) return true;

		return Array.isArray(section)
			? section.some(s => e.affectsConfiguration(s, scope!))
			: e.affectsConfiguration(section, scope!);
	}

	inspect<S extends ConfigPath, V extends ConfigPathValue<S>>(section: S, scope?: ConfigurationScope | null) {
		return workspace
			.getConfiguration(extensionPrefix, scope)
			.inspect<V>(section === undefined ? extensionPrefix : section);
	}

	inspectAny<S extends string, T>(section: S, scope?: ConfigurationScope | null) {
		return workspace.getConfiguration(undefined, scope).inspect<T>(section);
	}

	inspectCore<S extends CoreConfigPath, V extends CoreConfigPathValue<S>>(
		section: S,
		scope?: ConfigurationScope | null,
	) {
		return workspace.getConfiguration(undefined, scope).inspect<V>(section);
	}

	isUnset<S extends ConfigPath>(section: S, scope?: ConfigurationScope | null): boolean {
		const inspect = this.inspect(section, scope)!;
		if (inspect.workspaceFolderValue !== undefined) return false;
		if (inspect.workspaceValue !== undefined) return false;
		if (inspect.globalValue !== undefined) return false;

		return true;
	}

	async migrate<S extends ConfigPath>(
		from: string,
		to: S,
		options: { fallbackValue?: ConfigPathValue<S>; migrationFn?(value: any): ConfigPathValue<S> },
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

	async migrateIfMissing<S extends ConfigPath>(
		from: string,
		to: S,
		options: { migrationFn?(value: any): ConfigPathValue<S> },
	): Promise<void> {
		const fromInspection = this.inspect(from as any);
		if (fromInspection === undefined) return;

		const toInspection = this.inspect(to);
		if (fromInspection.globalValue !== undefined) {
			if (toInspection?.globalValue === undefined) {
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
			if (toInspection?.workspaceValue === undefined) {
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
			if (toInspection?.workspaceFolderValue === undefined) {
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

	matches<S extends ConfigPath>(match: S, section: ConfigPath, value: unknown): value is ConfigPathValue<S> {
		return match === section;
	}

	name<S extends ConfigPath>(section: S): string {
		return section;
	}

	update<S extends ConfigPath>(
		section: S,
		value: ConfigPathValue<S> | undefined,
		target: ConfigurationTarget,
	): Thenable<void> {
		return workspace.getConfiguration(extensionPrefix).update(section, value, target);
	}

	updateAny<S extends string, T>(
		section: S,
		value: T,
		target: ConfigurationTarget,
		scope?: ConfigurationScope | null,
	): Thenable<void> {
		return workspace
			.getConfiguration(undefined, target === ConfigurationTarget.Global ? undefined : scope!)
			.update(section, value, target);
	}

	updateEffective<S extends ConfigPath>(section: S, value: ConfigPathValue<S> | undefined): Thenable<void> {
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

export type CoreConfigPath = Path<CoreConfig>;
export type CoreConfigPathValue<P extends CoreConfigPath> = PathValue<CoreConfig, P>;
