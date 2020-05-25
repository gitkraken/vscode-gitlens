'use strict';
import { Event, EventEmitter } from 'vscode';
import * as keytarType from 'keytar';
import { extensionId } from './constants';
import { Logger } from './logger';

const CredentialKey = `${extensionId}:vscode`;

// keytar depends on a native module shipped in vscode
function getNodeModule<T>(moduleName: string): T | undefined {
	// eslint-disable-next-line no-eval
	const vscodeRequire = eval('require');
	try {
		return vscodeRequire(moduleName);
	} catch {
		return undefined;
	}
}

const keychain = getNodeModule<typeof keytarType>('keytar');

interface CredentialSaveEvent {
	key: string;
	reason: 'save';
}

interface CredentialClearEvent {
	key: string | undefined;
	reason: 'clear';
}

export type CredentialChangeEvent = CredentialSaveEvent | CredentialClearEvent;

export namespace CredentialManager {
	const _onDidChange = new EventEmitter<CredentialChangeEvent>();
	export const onDidChange: Event<CredentialChangeEvent> = _onDidChange.event;

	export async function addOrUpdate(key: string, value: string | object) {
		// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
		if (!key || !value) return;
		if (keychain == null) {
			Logger.log('CredentialManager.addOrUpdate: No credential store found');
			return;
		}

		try {
			await keychain.setPassword(CredentialKey, key, typeof value === 'string' ? value : JSON.stringify(value));
			_onDidChange.fire({ key: key, reason: 'save' });
		} catch (ex) {
			Logger.error(ex, 'CredentialManager.addOrUpdate: Failed to set credentials');
		}
	}

	export async function clear(key: string) {
		if (!key) return;
		if (keychain == null) {
			Logger.log('CredentialManager.clear: No credential store found');
			return;
		}

		try {
			await keychain.deletePassword(CredentialKey, key);
			_onDidChange.fire({ key: key, reason: 'clear' });
		} catch (ex) {
			Logger.error(ex, 'CredentialManager.clear: Failed to clear credentials');
		}
	}

	export async function get(key: string): Promise<string | undefined> {
		if (!key) return undefined;
		if (keychain == null) {
			Logger.log('CredentialManager.clear: No credential store found');
			return undefined;
		}

		try {
			const value = await keychain.getPassword(CredentialKey, key);

			return value ?? undefined;
		} catch (ex) {
			Logger.error(ex, 'CredentialManager.get: Failed to get credentials');
			return undefined;
		}
	}

	export async function getAs<T extends object>(key: string): Promise<T | undefined> {
		const value = await get(key);
		if (value == null) return undefined;

		return JSON.parse(value) as T;
	}
}
