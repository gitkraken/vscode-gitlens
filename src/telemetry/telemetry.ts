import type { AttributeValue, Span } from '@opentelemetry/api';
import type { Disposable } from 'vscode';
import { version as codeVersion, env } from 'vscode';
import { getProxyAgent } from '@env/fetch';
import { getPlatform } from '@env/platform';
import { configuration } from '../configuration';
import type { Container } from '../container';

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
	vscodeVersion: string;
}

export interface TelemetryProvider extends Disposable {
	sendEvent(name: string, data?: Record<string, AttributeValue>): void;
	startEvent(name: string, data?: Record<string, AttributeValue>): Span;
	setGlobalAttributes(attributes: Map<string, AttributeValue>): void;
}

interface QueuedEvent {
	type: 'sendEvent';
	name: string;
	data?: Record<string, AttributeValue>;
}

export class TelemetryService implements Disposable {
	private provider: TelemetryProvider | undefined;
	private enabled: boolean = false;
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
		this.enabled = env.isTelemetryEnabled && configuration.get('telemetry.enabled', undefined, true);
		if (!this.enabled) {
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
				vscodeVersion: codeVersion,
			},
			getProxyAgent(),
			container.debugging,
		);

		this.provider.setGlobalAttributes(this.globalAttributes);

		if (this.eventQueue.length) {
			const queue = [...this.eventQueue];
			this.eventQueue.length = 0;

			for (const { type, name, data } of queue) {
				if (type === 'sendEvent') {
					this.provider.sendEvent(name, data);
				}
			}
		}
	}

	sendEvent(name: string, data?: Record<string, AttributeValue | null | undefined>): void {
		if (!this.enabled) return;

		const attributes = stripNullOrUndefinedAttributes(data);
		if (this.provider == null) {
			this.eventQueue.push({ type: 'sendEvent', name: name, data: attributes });
			return;
		}
		this.provider.sendEvent(name, attributes);
	}

	async startEvent(
		name: string,
		data?: Record<string, AttributeValue | null | undefined>,
	): Promise<Span | undefined> {
		if (!this.enabled) return;

		if (this.provider == null) {
			await this.initializeTelemetry(this.container);
		}

		const attributes = stripNullOrUndefinedAttributes(data);
		return this.provider!.startEvent(name, attributes);
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
	let attributes: Record<string, AttributeValue> | undefined;
	if (data != null) {
		attributes = Object.create(null);
		for (const [key, value] of Object.entries(data)) {
			if (value == null) continue;

			attributes![key] = value;
		}
	}
	return attributes;
}
