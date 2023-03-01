import { Disposable } from 'vscode';
import { commandPrefix, ContextKeys } from '../constants';
import { setContext } from '../context';
import { registerCommand } from './command';
import { log } from './decorators/log';
import { Logger } from './logger';
import { getLogScope } from './logger.scope';

export declare interface KeyCommand {
	onDidPressKey?(key: Keys): void | Promise<void>;
}

const keyNoopCommand = Object.create(null) as KeyCommand;
export { keyNoopCommand as KeyNoopCommand };

export const keys = [
	'left',
	'alt+left',
	'ctrl+left',
	'right',
	'alt+right',
	'ctrl+right',
	'alt+,',
	'alt+.',
	'escape',
] as const;
export type Keys = (typeof keys)[number];

export type KeyMapping = { [K in Keys]?: KeyCommand | (() => Promise<KeyCommand>) };
type IndexableKeyMapping = KeyMapping & {
	[index: string]: KeyCommand | (() => Promise<KeyCommand>) | undefined;
};

const mappings: KeyMapping[] = [];

export class KeyboardScope implements Disposable {
	private readonly _mapping: IndexableKeyMapping;
	constructor(mapping: KeyMapping) {
		this._mapping = mapping;
		for (const key in this._mapping) {
			this._mapping[key] = this._mapping[key] ?? keyNoopCommand;
		}

		mappings.push(this._mapping);
	}

	@log({
		args: false,
		prefix: context => `${context.prefix}[${mappings.length}]`,
	})
	async dispose() {
		const index = mappings.indexOf(this._mapping);

		const scope = getLogScope();
		if (scope != null) {
			scope.exitDetails = ` \u2022 index=${index}`;
		}

		if (index === mappings.length - 1) {
			mappings.pop();
			await this.updateKeyCommandsContext(mappings[mappings.length - 1]);
		} else {
			mappings.splice(index, 1);
		}
	}

	private _paused = true;
	get paused() {
		return this._paused;
	}

	@log<KeyboardScope['clearKeyCommand']>({
		args: false,
		prefix: (context, key) => `${context.prefix}[${mappings.length}](${key})`,
	})
	async clearKeyCommand(key: Keys) {
		const scope = getLogScope();

		const mapping = mappings[mappings.length - 1];
		if (mapping !== this._mapping || mapping[key] == null) {
			if (scope != null) {
				scope.exitDetails = ' \u2022 skipped';
			}

			return;
		}

		mapping[key] = undefined;
		await setContext(`${ContextKeys.KeyPrefix}${key}`, false);
	}

	@log({
		args: false,
		prefix: context => `${context.prefix}(paused=${context.instance._paused})`,
	})
	async pause(keys?: Keys[]) {
		if (this._paused) return;

		this._paused = true;
		const mapping = (Object.keys(this._mapping) as Keys[]).reduce<KeyMapping>((accumulator, key) => {
			accumulator[key] = keys == null || keys.includes(key) ? undefined : this._mapping[key];
			return accumulator;
		}, Object.create(null));

		await this.updateKeyCommandsContext(mapping);
	}

	@log({
		args: false,
		prefix: context => `${context.prefix}(paused=${context.instance._paused})`,
	})
	async resume() {
		if (!this._paused) return;

		this._paused = false;
		await this.updateKeyCommandsContext(this._mapping);
	}

	async start() {
		await this.resume();
	}

	@log<KeyboardScope['setKeyCommand']>({
		args: false,
		prefix: (context, key) => `${context.prefix}[${mappings.length}](${key})`,
	})
	async setKeyCommand(key: Keys, command: KeyCommand | (() => Promise<KeyCommand>)) {
		const scope = getLogScope();

		const mapping = mappings[mappings.length - 1];
		if (mapping !== this._mapping) {
			if (scope != null) {
				scope.exitDetails = ' \u2022 skipped';
			}

			return;
		}

		const set = Boolean(mapping[key]);

		mapping[key] = command;
		if (!set) {
			await setContext(`${ContextKeys.KeyPrefix}${key}`, true);
		}
	}

	private async updateKeyCommandsContext(mapping: KeyMapping) {
		await Promise.all(keys.map(key => setContext(`${ContextKeys.KeyPrefix}${key}`, Boolean(mapping?.[key]))));
	}
}

export class Keyboard implements Disposable {
	private readonly _disposable: Disposable;

	constructor() {
		const subscriptions = keys.map(key =>
			registerCommand(`${commandPrefix}.key.${key}`, () => this.execute(key), this),
		);
		this._disposable = Disposable.from(...subscriptions);
	}

	dispose() {
		this._disposable.dispose();
	}

	@log<Keyboard['createScope']>({
		args: false,
		prefix: (context, mapping) =>
			`${context.prefix}[${mappings.length}](${mapping === undefined ? '' : Object.keys(mapping).join(',')})`,
	})
	createScope(mapping?: KeyMapping): KeyboardScope {
		return new KeyboardScope({ ...mapping });
	}

	@log<Keyboard['beginScope']>({
		args: false,
		prefix: (context, mapping) =>
			`${context.prefix}[${mappings.length}](${mapping === undefined ? '' : Object.keys(mapping).join(',')})`,
	})
	async beginScope(mapping?: KeyMapping): Promise<KeyboardScope> {
		const scope = this.createScope(mapping);
		await scope.start();
		return scope;
	}

	@log()
	async execute(key: Keys): Promise<void> {
		const scope = getLogScope();

		if (!mappings.length) {
			if (scope != null) {
				scope.exitDetails = ' \u2022 skipped, no mappings';
			}

			return;
		}

		try {
			const mapping = mappings[mappings.length - 1];

			let command = mapping[key] as KeyCommand | (() => Promise<KeyCommand>);
			if (typeof command === 'function') {
				command = await command();
			}
			if (typeof command?.onDidPressKey !== 'function') {
				if (scope != null) {
					scope.exitDetails = ' \u2022 skipped, no callback';
				}

				return;
			}

			await command.onDidPressKey(key);
		} catch (ex) {
			Logger.error(ex, scope);
		}
	}
}
