import { createContext } from '@lit/context';
import { Logger } from '../../../../system/logger.js';
import type { ScopedLogger } from '../../../../system/logger.scope.js';
import { getNewLogScope } from '../../../../system/logger.scope.js';
import { padOrTruncateEnd } from '../../../../system/string.js';

export class LoggerContext {
	private readonly scope: ScopedLogger;

	constructor(appName: string) {
		this.scope = getNewLogScope(appName, undefined);
		Logger.configure(
			{
				name: appName,
				createChannel: function (name: string) {
					const appendLine = Logger.isDebugging
						? function (_message: string, ..._args: any[]) {} // if debugging, don't log to the console, because the logger already will
						: function (message: string, ...args: any[]) {
								console.log(
									`[${padOrTruncateEnd(name, 13)}]`,
									Logger.timestamp,
									message ?? '',
									...args,
								);
							};

					return {
						name: name,
						logLevel: DEBUG ? 2 : 0,

						trace: appendLine,
						debug: appendLine,
						info: appendLine,
						warn: appendLine,
						error: appendLine,
					};
				},
			},
			DEBUG,
		);
	}

	trace(messageOrScope: string | ScopedLogger | undefined, ...optionalParams: any[]): void {
		if (typeof messageOrScope === 'string') {
			Logger.trace(this.scope, messageOrScope, ...optionalParams);
		} else {
			Logger.trace(messageOrScope, optionalParams.shift(), ...optionalParams);
		}
	}

	debug(messageOrScope: string | ScopedLogger | undefined, ...optionalParams: any[]): void {
		if (typeof messageOrScope === 'string') {
			Logger.debug(this.scope, messageOrScope, ...optionalParams);
		} else {
			Logger.debug(messageOrScope, optionalParams.shift(), ...optionalParams);
		}
	}

	info(messageOrScope: string | ScopedLogger | undefined, ...optionalParams: any[]): void {
		if (typeof messageOrScope === 'string') {
			Logger.info(this.scope, messageOrScope, ...optionalParams);
		} else {
			Logger.info(messageOrScope, optionalParams.shift(), ...optionalParams);
		}
	}
}

export const loggerContext = createContext<LoggerContext>('logger');
