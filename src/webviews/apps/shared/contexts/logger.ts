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
					return {
						name: name,
						appendLine: Logger.isDebugging
							? function () {} // if debugging, don't log to the console, because the logger already will
							: function (value: string) {
									console.log(`[${padOrTruncateEnd(name, 13)}] ${value}`);
								},
					};
				},
			},
			DEBUG ? 'debug' : 'off',
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
