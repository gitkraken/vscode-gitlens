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
import { Objects } from './system';

const emptyConfig: Config = new Proxy<Config>({} as Config, {
	get: function() {
		return emptyConfig;
	}
});

type ConfigInspection<T> = {
	key: string;
	defaultValue?: T;
	globalValue?: T;
	workspaceValue?: T;
	workspaceFolderValue?: T;
};

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

	get(): Config;
	get<S1 extends keyof Config>(s1: S1, resource?: Uri | null, defaultValue?: Config[S1]): Config[S1];
	get<S1 extends keyof Config, S2 extends keyof Config[S1]>(
		s1: S1,
		s2: S2,
		resource?: Uri | null,
		defaultValue?: Config[S1][S2]
	): Config[S1][S2];
	get<S1 extends keyof Config, S2 extends keyof Config[S1], S3 extends keyof Config[S1][S2]>(
		s1: S1,
		s2: S2,
		s3: S3,
		resource?: Uri | null,
		defaultValue?: Config[S1][S2][S3]
	): Config[S1][S2][S3];
	get<
		S1 extends keyof Config,
		S2 extends keyof Config[S1],
		S3 extends keyof Config[S1][S2],
		S4 extends keyof Config[S1][S2][S3]
	>(
		s1: S1,
		s2: S2,
		s3: S3,
		s4: S4,
		resource?: Uri | null,
		defaultValue?: Config[S1][S2][S3][S4]
	): Config[S1][S2][S3][S4];
	get<T>(...args: any[]): T {
		let section: string | undefined;
		let resource: Uri | null | undefined;
		let defaultValue: T | undefined;
		if (args.length > 0) {
			section = args[0];
			if (typeof args[1] === 'string') {
				section += `.${args[1]}`;
				if (typeof args[2] === 'string') {
					section += `.${args[2]}`;
					if (typeof args[2] === 'string') {
						section += `.${args[3]}`;
						resource = args[4];
						defaultValue = args[5];
					} else {
						resource = args[3];
						defaultValue = args[4];
					}
				} else {
					resource = args[2];
					defaultValue = args[3];
				}
			} else {
				resource = args[1];
				defaultValue = args[2];
			}
		}

		return defaultValue === undefined
			? workspace
					.getConfiguration(section === undefined ? undefined : extensionId, resource)
					.get<T>(section === undefined ? extensionId : section)!
			: workspace
					.getConfiguration(section === undefined ? undefined : extensionId, resource)
					.get<T>(section === undefined ? extensionId : section, defaultValue)!;
	}

	getAny<T>(section: string, resource?: Uri | null, defaultValue?: T) {
		return defaultValue === undefined
			? workspace.getConfiguration(undefined, resource).get<T>(section)!
			: workspace.getConfiguration(undefined, resource).get<T>(section, defaultValue)!;
	}

	changed<S1 extends keyof Config>(e: ConfigurationChangeEvent, s1: S1, resource?: Uri | null): boolean;
	changed<S1 extends keyof Config, S2 extends keyof Config[S1]>(
		e: ConfigurationChangeEvent,
		s1: S1,
		s2: S2,
		resource?: Uri | null
	): boolean;
	changed<S1 extends keyof Config, S2 extends keyof Config[S1], S3 extends keyof Config[S1][S2]>(
		e: ConfigurationChangeEvent,
		s1: S1,
		s2: S2,
		s3: S3,
		resource?: Uri | null
	): boolean;
	changed<
		S1 extends keyof Config,
		S2 extends keyof Config[S1],
		S3 extends keyof Config[S1][S2],
		S4 extends keyof Config[S1][S2][S3]
	>(e: ConfigurationChangeEvent, s1: S1, s2: S2, s3: S3, s4: S4, resource?: Uri | null): boolean;
	changed(e: ConfigurationChangeEvent, ...args: any[]) {
		let section: string = args[0];
		let resource: Uri | null | undefined;
		if (typeof args[1] === 'string') {
			section += `.${args[1]}`;
			if (typeof args[2] === 'string') {
				section += `.${args[2]}`;
				if (typeof args[3] === 'string') {
					section += args[3];
					resource = args[4];
				} else {
					resource = args[3];
				}
			} else {
				resource = args[2];
			}
		} else {
			resource = args[1];
		}

		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
		return e.affectsConfiguration(`${extensionId}.${section}`, resource!);
	}

	initializing(e: ConfigurationChangeEvent) {
		return e === this.initializingChangeEvent;
	}

	inspect<S1 extends keyof Config>(s1: S1, resource?: Uri | null): ConfigInspection<Config[S1]> | undefined;
	inspect<S1 extends keyof Config, S2 extends keyof Config[S1]>(
		s1: S1,
		s2: S2,
		resource?: Uri | null
	): ConfigInspection<Config[S1][S2]> | undefined;
	inspect<S1 extends keyof Config, S2 extends keyof Config[S1], S3 extends keyof Config[S1][S2]>(
		s1: S1,
		s2: S2,
		s3: S3,
		resource?: Uri | null
	): ConfigInspection<Config[S1][S2][S3]> | undefined;
	inspect<
		S1 extends keyof Config,
		S2 extends keyof Config[S1],
		S3 extends keyof Config[S1][S2],
		S4 extends keyof Config[S1][S2][S3]
	>(s1: S1, s2: S2, s3: S3, s4: S4, resource?: Uri | null): ConfigInspection<Config[S1][S2][S3][S4]> | undefined;
	inspect(...args: any[]) {
		let section: string = args[0];
		let resource: Uri | null | undefined;
		if (typeof args[1] === 'string') {
			section += `.${args[1]}`;
			if (typeof args[2] === 'string') {
				section += `.${args[2]}`;
				if (typeof args[3] === 'string') {
					section += args[3];
					resource = args[4];
				} else {
					resource = args[3];
				}
			} else {
				resource = args[2];
			}
		} else {
			resource = args[1];
		}

		return workspace
			.getConfiguration(section === undefined ? undefined : extensionId, resource)
			.inspect(section === undefined ? extensionId : section);
	}

	inspectAny(section: string, resource?: Uri | null) {
		return workspace.getConfiguration(undefined, resource).inspect(section);
	}

	migrate<S1 extends keyof Config>(
		from: string,
		to1: S1,
		options: { fallbackValue?: Config[S1]; migrationFn?(value: any): Config[S1] }
	): Promise<boolean>;
	migrate<S1 extends keyof Config, S2 extends keyof Config[S1]>(
		from: string,
		to1: S1,
		to2: S2,
		options: { fallbackValue?: Config[S1][S2]; migrationFn?(value: any): Config[S1][S2] }
	): Promise<boolean>;
	migrate<S1 extends keyof Config, S2 extends keyof Config[S1], S3 extends keyof Config[S1][S2]>(
		from: string,
		to1: S1,
		to2: S2,
		to3: S3,
		options: { fallbackValue?: Config[S1][S2][S3]; migrationFn?(value: any): Config[S1][S2][S3] }
	): Promise<boolean>;
	migrate<
		S1 extends keyof Config,
		S2 extends keyof Config[S1],
		S3 extends keyof Config[S1][S2],
		S4 extends keyof Config[S1][S2][S3]
	>(
		from: string,
		to1: S1,
		to2: S2,
		to3: S3,
		to4: S4,
		options: { fallbackValue?: Config[S1][S2][S3][S4]; migrationFn?(value: any): Config[S1][S2][S3][S4] }
	): Promise<boolean>;
	async migrate(from: string, ...args: any[]): Promise<boolean> {
		let to: string = args[0];
		let options: { fallbackValue?: any; migrationFn?(value: any): any } | undefined;
		if (typeof args[1] === 'string' && args.length > 3) {
			to += `.${args[1]}`;
			if (typeof args[2] === 'string' && args.length > 4) {
				to += `.${args[2]}`;
				if (typeof args[3] === 'string' && args.length > 5) {
					to += `.${args[3]}`;
					options = args[4];
				} else {
					options = args[3];
				}
			} else {
				options = args[2];
			}
		} else {
			options = args[1];
		}

		if (options === undefined) {
			options = {};
		}

		const inspection = configuration.inspect(from as any);
		if (inspection === undefined) return false;

		let migrated = false;
		if (inspection.globalValue !== undefined) {
			await this.update(
				to as any,
				options.migrationFn ? options.migrationFn(inspection.globalValue) : inspection.globalValue,
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
				to as any,
				options.migrationFn ? options.migrationFn(inspection.workspaceValue) : inspection.workspaceValue,
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
				to as any,
				options.migrationFn
					? options.migrationFn(inspection.workspaceFolderValue)
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
			await this.update(to as any, options.fallbackValue, ConfigurationTarget.Global);
			migrated = true;
		}

		return migrated;
	}

	migrateIfMissing<S1 extends keyof Config>(
		from: string,
		to1: S1,
		options: { migrationFn?(value: any): Config[S1] }
	): Promise<void>;
	migrateIfMissing<S1 extends keyof Config, S2 extends keyof Config[S1]>(
		from: string,
		to1: S1,
		to2: S2,
		options: { migrationFn?(value: any): Config[S1][S2] }
	): Promise<void>;
	migrateIfMissing<S1 extends keyof Config, S2 extends keyof Config[S1], S3 extends keyof Config[S1][S2]>(
		from: string,
		to1: S1,
		to2: S2,
		to3: S3,
		options: { migrationFn?(value: any): Config[S1][S2][S3] }
	): Promise<void>;
	migrateIfMissing<
		S1 extends keyof Config,
		S2 extends keyof Config[S1],
		S3 extends keyof Config[S1][S2],
		S4 extends keyof Config[S1][S2][S3]
	>(
		from: string,
		to1: S1,
		to2: S2,
		to3: S3,
		to4: S4,
		options: { migrationFn?(value: any): Config[S1][S2][S3][S4] }
	): Promise<void>;
	async migrateIfMissing(from: string, ...args: any[]): Promise<void> {
		let to: string = args[0];
		let options: { migrationFn?(value: any): any } | undefined;
		if (typeof args[1] === 'string' && args.length > 3) {
			to += `.${args[1]}`;
			if (typeof args[2] === 'string' && args.length > 4) {
				to += `.${args[2]}`;
				if (typeof args[3] === 'string' && args.length > 5) {
					to += `.${args[3]}`;
					options = args[4];
				} else {
					options = args[3];
				}
			} else {
				options = args[2];
			}
		} else {
			options = args[1];
		}

		if (options === undefined) {
			options = {};
		}

		// async migrateIfMissing<TFrom, TTo>(from: string, to: string, options: { migrationFn?(value: TFrom): TTo } = {}) {
		const fromInspection = configuration.inspect(from as any);
		if (fromInspection === undefined) return;

		const toInspection = configuration.inspect(to as any);
		if (fromInspection.globalValue !== undefined) {
			if (toInspection === undefined || toInspection.globalValue === undefined) {
				await this.update(
					to as any,
					options.migrationFn ? options.migrationFn(fromInspection.globalValue) : fromInspection.globalValue,
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
					to as any,
					options.migrationFn
						? options.migrationFn(fromInspection.workspaceValue)
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
					to as any,
					options.migrationFn
						? options.migrationFn(fromInspection.workspaceFolderValue)
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

	name<S1 extends keyof Config>(s1: S1): string;
	name<S1 extends keyof Config, S2 extends keyof Config[S1]>(s1: S1, s2: S2): string;
	name<S1 extends keyof Config, S2 extends keyof Config[S1], S3 extends keyof Config[S1][S2]>(
		s1: S1,
		s2: S2,
		s3: S3
	): string;
	name<
		S1 extends keyof Config,
		S2 extends keyof Config[S1],
		S3 extends keyof Config[S1][S2],
		S4 extends keyof Config[S1][S2][S3]
	>(s1: S1, s2: S2, s3: S3, s4: S4): string;
	name(...args: string[]) {
		return args.join('.');
	}

	update<S1 extends keyof Config>(s1: S1, value: Config[S1] | undefined, target: ConfigurationTarget): Thenable<void>;
	update<S1 extends keyof Config, S2 extends keyof Config[S1]>(
		s1: S1,
		s2: S2,
		value: Config[S1][S2] | undefined,
		target: ConfigurationTarget
	): Thenable<void>;

	update<S1 extends keyof Config, S2 extends keyof Config[S1], S3 extends keyof Config[S1][S2]>(
		s1: S1,
		s2: S2,
		s3: S3,
		value: Config[S1][S2][S3] | undefined,
		target: ConfigurationTarget
	): Thenable<void>;
	update<
		S1 extends keyof Config,
		S2 extends keyof Config[S1],
		S3 extends keyof Config[S1][S2],
		S4 extends keyof Config[S1][S2][S3]
	>(
		s1: S1,
		s2: S2,
		s3: S3,
		s4: S4,
		value: Config[S1][S2][S3][S4] | undefined,
		target: ConfigurationTarget
	): Thenable<void>;
	update(...args: any[]) {
		let section: string = args[0];
		let value;
		let target: ConfigurationTarget;
		if (typeof args[1] === 'string' && args.length > 3) {
			section += `.${args[1]}`;
			if (typeof args[2] === 'string' && args.length > 4) {
				section += `.${args[2]}`;
				if (typeof args[3] === 'string' && args.length > 5) {
					section += `.${args[3]}`;
					value = args[4];
					target = args[5];
				} else {
					value = args[3];
					target = args[4];
				}
			} else {
				value = args[2];
				target = args[3];
			}
		} else {
			value = args[1];
			target = args[2];
		}

		return workspace.getConfiguration(extensionId).update(section, value, target);
	}

	updateAny(section: string, value: any, target: ConfigurationTarget, resource?: Uri | null) {
		return workspace
			.getConfiguration(undefined, target === ConfigurationTarget.Global ? undefined : resource!)
			.update(section, value, target);
	}

	updateEffective<S1 extends keyof Config>(s1: S1, value: Config[S1]): Thenable<void>;
	updateEffective<S1 extends keyof Config, S2 extends keyof Config[S1]>(
		s1: S1,
		s2: S2,
		value: Config[S1][S2]
	): Thenable<void>;
	updateEffective<S1 extends keyof Config, S2 extends keyof Config[S1], S3 extends keyof Config[S1][S2]>(
		s1: S1,
		s2: S2,
		s3: S3,
		value: Config[S1][S2][S3]
	): Thenable<void>;
	updateEffective<
		S1 extends keyof Config,
		S2 extends keyof Config[S1],
		S3 extends keyof Config[S1][S2],
		S4 extends keyof Config[S1][S2][S3]
	>(s1: S1, s2: S2, s3: S3, s4: S4, value: Config[S1][S2][S3][S4]): Thenable<void>;
	updateEffective(...args: any[]) {
		let section: string = args[0];
		let value;
		if (typeof args[1] === 'string' && args.length > 2) {
			section += `.${args[1]}`;
			if (typeof args[2] === 'string' && args.length > 3) {
				section += `.${args[2]}`;
				if (typeof args[3] === 'string' && args.length > 4) {
					section += `.${args[3]}`;
					value = args[4];
				} else {
					value = args[3];
				}
			} else {
				value = args[2];
			}
		} else {
			value = args[1];
		}

		const inspect = configuration.inspect(section as any)!;
		if (inspect.workspaceFolderValue !== undefined) {
			if (value === inspect.workspaceFolderValue) return Promise.resolve(undefined);

			return configuration.update(section as any, value, ConfigurationTarget.WorkspaceFolder);
		}

		if (inspect.workspaceValue !== undefined) {
			if (value === inspect.workspaceValue) return Promise.resolve(undefined);

			return configuration.update(section as any, value, ConfigurationTarget.Workspace);
		}

		if (inspect.globalValue === value || (inspect.globalValue === undefined && value === inspect.defaultValue)) {
			return Promise.resolve(undefined);
		}

		return configuration.update(
			section as any,
			Objects.areEquivalent(value, inspect.defaultValue) ? undefined : value,
			ConfigurationTarget.Global
		);
	}
}

export const configuration = new Configuration();
