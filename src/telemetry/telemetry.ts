import type { AttributeValue, Span, TimeInput } from '@opentelemetry/api';
import type { Disposable } from 'vscode';
import { version as codeVersion, env } from 'vscode';
import { getProxyAgent } from '@env/fetch';
import { getPlatform } from '@env/platform';
import type { Container } from '../container';
import { configuration } from '../system/configuration';

export interface TelemetryContext {
	env: string;
	extensionId: string;
	extensionVersion: string;
	machineId: string;
	sessionId: string;
	language: string;
	platform: string;
	vscodeEdition: string;
	vscodeHost: string;
	vscodeRemoteName: string;
	vscodeShell: string;
	vscodeUIKind: string;
	vscodeVersion: string;
}

export interface TelemetryProvider extends Disposable {
	sendEvent(name: string, data?: Record<string, AttributeValue>, startTime?: TimeInput, endTime?: TimeInput): void;
	startEvent(name: string, data?: Record<string, AttributeValue>, startTime?: TimeInput): Span;
	setGlobalAttributes(attributes: Map<string, AttributeValue>): void;
}

interface QueuedEvent {
	type: 'sendEvent';
	name: string;
	data?: Record<string, AttributeValue | null | undefined>;
	global: Map<string, AttributeValue>;
	startTime: TimeInput;
	endTime: TimeInput;
}

export class TelemetryService implements Disposable {
	private _enabled: boolean = false;
	get enabled(): boolean {
		return this._enabled;
	}

	private provider: TelemetryProvider | undefined;
	private globalAttributes = new Map<string, AttributeValue>();
	private eventQueue: QueuedEvent[] = [];

	constructor(private readonly container: Container) {
		container.context.subscriptions.push(
			configuration.onDidChange(e => {
				if (!e.affectsConfiguration('telemetry.enabled')) return;

				this.ensureTelemetry(container);
			}),
			env.onDidChangeTelemetryEnabled(() => this.ensureTelemetry(container)),
		);
		this.ensureTelemetry(container);
	}

	dispose(): void {
		this.provider?.dispose();
		this.provider = undefined;
	}

	private _initializationTimer: ReturnType<typeof setTimeout> | undefined;
	private ensureTelemetry(container: Container): void {
		this._enabled = env.isTelemetryEnabled && configuration.get('telemetry.enabled', undefined, true);
		if (!this._enabled) {
			if (this._initializationTimer != null) {
				clearTimeout(this._initializationTimer);
				this._initializationTimer = undefined;
			}

			this.eventQueue.length = 0;

			this.provider?.dispose();
			this.provider = undefined;

			return;
		}

		if (this._initializationTimer != null) return;
		this._initializationTimer = setTimeout(() => this.initializeTelemetry(container), 7500);
	}

	private async initializeTelemetry(container: Container) {
		if (this._initializationTimer != null) {
			clearTimeout(this._initializationTimer);
			this._initializationTimer = undefined;
		}

		this.provider = new (
			await import(/* webpackChunkName: "telemetry" */ './openTelemetryProvider')
		).OpenTelemetryProvider(
			{
				env: container.env,
				extensionId: container.id,
				extensionVersion: container.version,
				machineId: env.machineId,
				sessionId: env.sessionId,
				language: env.language,
				platform: getPlatform(),
				vscodeEdition: env.appName,
				vscodeHost: env.appHost,
				vscodeRemoteName: env.remoteName ?? '',
				vscodeShell: env.shell,
				vscodeUIKind: String(env.uiKind),
				vscodeVersion: codeVersion,
			},
			getProxyAgent(),
			container.debugging,
		);

		if (this.eventQueue.length) {
			const queue = [...this.eventQueue];
			this.eventQueue.length = 0;

			for (const { type, name, data, global } of queue) {
				if (type === 'sendEvent') {
					this.provider.setGlobalAttributes(global);
					this.provider.sendEvent(name, stripNullOrUndefinedAttributes(data));
				}
			}
		}

		this.provider.setGlobalAttributes(this.globalAttributes);
	}

	sendEvent(
		name: string,
		data?: Record<string, AttributeValue | null | undefined>,
		startTime?: TimeInput,
		endTime?: TimeInput,
	): void {
		if (!this._enabled) return;

		if (this.provider == null) {
			this.eventQueue.push({
				type: 'sendEvent',
				name: name,
				data: data,
				global: new Map([...this.globalAttributes]),
				startTime: startTime ?? Date.now(),
				endTime: endTime ?? Date.now(),
			});
			return;
		}

		this.provider.sendEvent(name, stripNullOrUndefinedAttributes(data), startTime, endTime);
	}

	startEvent(
		name: string,
		data?: Record<string, AttributeValue | null | undefined>,
		startTime?: TimeInput,
	): Disposable | undefined {
		if (!this._enabled) return undefined;

		if (this.provider != null) {
			const span = this.provider.startEvent(name, stripNullOrUndefinedAttributes(data), startTime);
			return {
				dispose: () => span?.end(),
			};
		}

		startTime = startTime ?? Date.now();
		return {
			dispose: () => this.sendEvent(name, data, startTime, Date.now()),
		};
	}

	// sendErrorEvent(
	// 	name: string,
	// 	data?: Record<string, string>,
	// ): void {
	// }

	// sendException(
	// 	error: Error | unknown,
	// 	data?: Record<string, string>,
	// ): void {
	// }

	setGlobalAttribute(key: string, value: AttributeValue | null | undefined): void {
		if (value == null) {
			this.globalAttributes.delete(key);
		} else {
			this.globalAttributes.set(key, value);
		}
		this.provider?.setGlobalAttributes(this.globalAttributes);
	}

	setGlobalAttributes(attributes: Record<string, AttributeValue | null | undefined>): void {
		for (const [key, value] of Object.entries(attributes)) {
			if (value == null) {
				this.globalAttributes.delete(key);
			} else {
				this.globalAttributes.set(key, value);
			}
		}
		this.provider?.setGlobalAttributes(this.globalAttributes);
	}

	deleteGlobalAttribute(key: string): void {
		this.globalAttributes.delete(key);
		this.provider?.setGlobalAttributes(this.globalAttributes);
	}
}

function stripNullOrUndefinedAttributes(data: Record<string, AttributeValue | null | undefined> | undefined) {
	if (data == null) return undefined;

	const attributes: Record<string, AttributeValue> | undefined = Object.create(null);
	for (const [key, value] of Object.entries(data)) {
		if (value == null) continue;

		attributes![key] = value;
	}
	return attributes;
}
