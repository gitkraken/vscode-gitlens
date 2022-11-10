import { EventEmitter } from 'vscode';
import type { Event } from 'vscode';
import { Container } from '../../container';

export interface ConnectionStateChangeEvent {
	key: string;
	reason: 'connected' | 'disconnected';
}

export namespace RichRemoteProviders {
	const _connectedCache = new Set<string>();
	export const _onDidChangeConnectionState = new EventEmitter<ConnectionStateChangeEvent>();
	export const onDidChangeConnectionState: Event<ConnectionStateChangeEvent> = _onDidChangeConnectionState.event;

	export function connected(key: string): void {
		// Only fire events if the key is being connected for the first time
		if (_connectedCache.has(key)) return;

		_connectedCache.add(key);
		Container.instance.telemetry.sendEvent('remoteProviders/connected', { 'remoteProviders.key': key });

		_onDidChangeConnectionState.fire({ key: key, reason: 'connected' });
	}

	export function disconnected(key: string): void {
		// Probably shouldn't bother to fire the event if we don't already think we are connected, but better to be safe
		// if (!_connectedCache.has(key)) return;
		_connectedCache.delete(key);
		Container.instance.telemetry.sendEvent('remoteProviders/disconnected', { 'remoteProviders.key': key });

		_onDidChangeConnectionState.fire({ key: key, reason: 'disconnected' });
	}
}
