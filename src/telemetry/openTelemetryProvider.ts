import type { AttributeValue, Span, TimeInput, Tracer } from '@opentelemetry/api';
import { SpanKind } from '@opentelemetry/api';
// import { diag, DiagConsoleLogger } from '@opentelemetry/api';
// import { DiagLogLevel } from '@opentelemetry/api/build/src/diag/types';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import {
	BasicTracerProvider,
	BatchSpanProcessor,
	// ConsoleSpanExporter,
	SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {
	SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
	SEMRESATTRS_DEVICE_ID,
	SEMRESATTRS_OS_TYPE,
	SEMRESATTRS_SERVICE_NAME,
	SEMRESATTRS_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import type { HttpsProxyAgent } from 'https-proxy-agent';
import type { TelemetryContext, TelemetryProvider } from './telemetry';

export class OpenTelemetryProvider implements TelemetryProvider {
	private _globalAttributes: Record<string, AttributeValue> = {};

	private readonly provider: BasicTracerProvider;
	private readonly tracer: Tracer;

	constructor(context: TelemetryContext, agent?: HttpsProxyAgent, debugging?: boolean) {
		this.provider = new BasicTracerProvider({
			resource: new Resource({
				[SEMRESATTRS_SERVICE_NAME]: 'gitlens',
				[SEMRESATTRS_SERVICE_VERSION]: context.extensionVersion,
				[SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: context.env,
				[SEMRESATTRS_DEVICE_ID]: context.machineId,
				[SEMRESATTRS_OS_TYPE]: context.platform,
				'extension.id': context.extensionId,
				'session.id': context.sessionId,
				language: context.language,
				'vscode.edition': context.vscodeEdition,
				'vscode.version': context.vscodeVersion,
				'vscode.host': context.vscodeHost,
				'vscode.remoteName': context.vscodeRemoteName,
				'vscode.shell': context.vscodeShell,
				'vscode.uiKind': context.vscodeUIKind,
			}) as any,
		});

		// if (debugging) {
		// 	diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.VERBOSE);
		// 	this.provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
		// }

		const exporter = new OTLPTraceExporter({
			url: debugging ? 'https://otel-dev.gitkraken.com/v1/traces' : 'https://otel.gitkraken.com/v1/traces',
			compression: 'gzip' as any,
			httpAgentOptions: agent?.options,
		});
		this.provider.addSpanProcessor(
			debugging ? new SimpleSpanProcessor(exporter) : new BatchSpanProcessor(exporter),
		);

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
