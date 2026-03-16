import { getHostIpcApi } from '../ipc.js';

export interface HostStorage {
	get(): Record<string, unknown> | undefined;
	set(state: Record<string, unknown>): void;
}

export class VsCodeStorage implements HostStorage {
	private readonly _api = getHostIpcApi();

	get(): Record<string, unknown> | undefined {
		return this._api.getState() as Record<string, unknown> | undefined;
	}

	set(state: Record<string, unknown>): void {
		this._api.setState(state);
	}
}

export class BrowserStorage implements HostStorage {
	constructor(private readonly key: string) {}

	get(): Record<string, unknown> | undefined {
		const raw = localStorage.getItem(this.key);
		return raw != null ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
	}

	set(state: Record<string, unknown>): void {
		localStorage.setItem(this.key, JSON.stringify(state));
	}
}

export class InMemoryStorage implements HostStorage {
	private _state: Record<string, unknown> | undefined;

	get(): Record<string, unknown> | undefined {
		return this._state;
	}

	set(state: Record<string, unknown>): void {
		this._state = state;
	}
}

export const noopStorage: HostStorage = {
	get: () => undefined,
	set: () => {},
};
