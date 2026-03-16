import type { Logger as SupertalkLogger } from '@eamodio/supertalk';
import { Logger } from '../logger.js';

function toMessage(data: unknown[]): [message: string, rest: unknown[]] {
	if (typeof data[0] === 'string') {
		return [data[0], data.slice(1)];
	}
	return [data.map(String).join(' '), []];
}

/**
 * Adapts GitLens' Logger to Supertalk's console-compatible Logger interface.
 *
 * - debug: RPC call traces with duration (action, method, timing)
 * - warn: non-cloneable value warnings (debug mode only)
 * - error: handler onMessage errors
 */
export const supertalkLogger: SupertalkLogger = {
	debug: (...data: unknown[]) => {
		const [message, rest] = toMessage(data);
		Logger.debug(message, ...rest);
	},
	warn: (...data: unknown[]) => {
		const [message, rest] = toMessage(data);
		Logger.warn(message, ...rest);
	},
	error: (...data: unknown[]) => {
		// GitLens Logger.error expects (ex, message) — extract Error from args
		const [message, rest] = toMessage(data);
		const ex = rest.find((r): r is Error => r instanceof Error);
		Logger.error(ex, message);
	},
};
