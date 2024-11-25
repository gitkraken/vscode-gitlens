import type { AttributeValue, Span, TimeInput, Tracer } from '@opentelemetry/api';
import { SpanKind } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import type { SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { BasicTracerProvider, BatchSpanProcessor, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import {
	ATTR_DEPLOYMENT_ENVIRONMENT,
	ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
	ATTR_DEVICE_ID,
	ATTR_OS_TYPE,
} from '@opentelemetry/semantic-conventions/incubating';
import type { HttpsProxyAgent } from 'https-proxy-agent';
import type { TelemetryContext, TelemetryProvider } from './telemetry';

enum CompressionAlgorithm {
	NONE = 'none',
	GZIP = 'gzip',
}

export class OpenTelemetryProvider implements TelemetryProvider {
	private _globalAttributes: Record<string, AttributeValue> = {};

	private readonly provider: BasicTracerProvider;
	private readonly tracer: Tracer;

	constructor(context: TelemetryContext, agent?: HttpsProxyAgent, debugging?: boolean) {
		const exporter = new OTLPTraceExporter({
			url: debugging ? 'https://otel-dev.gitkraken.com/v1/traces' : 'https://otel.gitkraken.com/v1/traces',
			compression: CompressionAlgorithm.GZIP,
			httpAgentOptions: agent?.options,
		});

		const spanProcessors: SpanProcessor[] = [];
		if (debugging) {
			spanProcessors.push(new SimpleSpanProcessor(exporter));

			// diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.VERBOSE);
			// spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
		} else {
			spanProcessors.push(new BatchSpanProcessor(exporter));
		}

		this.provider = new BasicTracerProvider({
			resource: new Resource({
				[ATTR_SERVICE_NAME]: 'gitlens',
				[ATTR_SERVICE_VERSION]: context.extensionVersion,
				[ATTR_DEPLOYMENT_ENVIRONMENT]: context.env,
				[ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: context.env,
				[ATTR_DEVICE_ID]: context.machineId,
				[ATTR_OS_TYPE]: context.platform,
				'extension.id': context.extensionId,
				'session.id': context.sessionId,
				language: context.language,
				'vscode.edition': context.vscodeEdition,
				'vscode.version': context.vscodeVersion,
				'vscode.host': context.vscodeHost,
				'vscode.remoteName': context.vscodeRemoteName,
				'vscode.shell': context.vscodeShell,
				'vscode.uiKind': context.vscodeUIKind,
			}),
			spanProcessors: spanProcessors,
		});

		this.tracer = this.provider.getTracer(context.extensionId);
	}

	dispose(): void {
		void this.provider.shutdown();
	}

	sendEvent(name: string, data?: Record<string, AttributeValue>, startTime?: TimeInput, endTime?: TimeInput): void {
		const span = this.tracer.startSpan(name, {
			attributes: this._globalAttributes,
			kind: SpanKind.INTERNAL,
			startTime: startTime ?? Date.now(),
		});
		if (data != null) {
			span.setAttributes(data);
		}
		span.end(endTime);
	}

	startEvent(name: string, data?: Record<string, AttributeValue>, startTime?: TimeInput): Span {
		const span = this.tracer.startSpan(name, {
			attributes: this._globalAttributes,
			kind: SpanKind.INTERNAL,
			startTime: startTime ?? Date.now(),
		});
		if (data != null) {
			span.setAttributes(data);
		}
		return span;
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

	setGlobalAttributes(attributes: Map<string, AttributeValue>): void {
		this._globalAttributes = Object.fromEntries(attributes);
	}
}
