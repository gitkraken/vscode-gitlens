import { createContext } from '@lit/context';
import type { TimeInput } from '@opentelemetry/api';
import type { Source, TelemetryEvents } from '../../../constants.telemetry';
import { Logger } from '../../../system/logger';
import type { LogScope } from '../../../system/logger.scope';
import { getNewLogScope } from '../../../system/logger.scope';
import { padOrTruncateEnd } from '../../../system/string';
import { TelemetrySendEventCommand } from '../../protocol';
import type { Disposable } from './events';
import type { HostIpc } from './ipc';

export class LoggerContext {
	private readonly scope: LogScope;

	constructor(appName: string) {
		this.scope = getNewLogScope(appName, undefined);
		Logger.configure(
			{
				name: appName,
				createChannel: function (name: string) {
					return {
						name: name,
						appendLine: function (value: string) {
							console.log(`[${padOrTruncateEnd(name, 13)}] ${value}`);
						},
					};
				},
			},
			DEBUG ? 'debug' : 'off',
		);
	}

	log(messageOrScope: string | LogScope | undefined, ...optionalParams: any[]): void {
		if (typeof messageOrScope === 'string') {
			Logger.log(this.scope, messageOrScope, ...optionalParams);
		} else {
			Logger.log(messageOrScope, optionalParams.shift(), ...optionalParams);
		}
	}
}

export class TelemetryContext implements Disposable {
	private readonly ipc: HostIpc;
	private readonly disposables: Disposable[] = [];

	constructor(ipc: HostIpc) {
		this.ipc = ipc;
	}

	sendEvent<T extends keyof TelemetryEvents>(
		name: T,
		data?: TelemetryEvents[T],
		source?: Source,
		startTime?: TimeInput,
		endTime?: TimeInput,
	): void {
		this.ipc.sendCommand(TelemetrySendEventCommand, {
			name: name,
			data: data,
			source: source,
			startTime: startTime,
			endTime: endTime,
		});
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
	}
}

export const ipcContext = createContext<HostIpc>('ipc');
export const loggerContext = createContext<LoggerContext>('logger');
export const telemetryContext = createContext<unknown>('telemetry');
