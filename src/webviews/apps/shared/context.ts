import { createContext } from '@lit/context';
import { Logger } from '../../../system/logger';
import type { LogScope } from '../../../system/logger.scope';
import { getNewLogScope } from '../../../system/logger.scope';
import { padOrTruncateEnd } from '../../../system/string';
import type { TelemetrySendEventParams } from '../../protocol';
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
			DEBUG,
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

	sendEvent(detail: TelemetrySendEventParams): void {
		this.ipc.sendCommand(TelemetrySendEventCommand, detail);
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
	}
}

export const ipcContext = createContext<HostIpc>('ipc');
export const loggerContext = createContext<LoggerContext>('logger');
export const telemetryContext = createContext<unknown>('telemetry');
