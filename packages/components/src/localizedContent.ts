/**
 * Inserts existing Lit content at named placeholders in translated prose. The result is rendered
 * through a normal Lit child binding, so translations remain text and cannot create markup.
 * Pass a literal `l10n.t('... {name} ...')` message; leave its placeholders for this function.
 * A mismatch between the message's placeholders and the provided values is warned once per
 * distinct message via `console.warn`, without changing what gets rendered.
 */
export function localizedContent(message: string, values: Readonly<Record<string, unknown>>): unknown[] {
	const missing = new Set<string>();

	const parts = message.split(/(\{[^{}]+\})/g).map(part => {
		if (!part.startsWith('{') || !part.endsWith('}')) return part;

		const key = part.slice(1, -1);
		if (Object.hasOwn(values, key)) return values[key];

		missing.add(key);
		return part;
	});

	const unused = Object.keys(values).filter(key => !message.includes(`{${key}}`));
	if (missing.size || unused.length) {
		warnOnce(message, missing, unused);
	}

	return parts;
}

const reportedMessages = new Set<string>();

function warnOnce(message: string, missing: Set<string>, unused: string[]): void {
	if (reportedMessages.has(message)) return;

	reportedMessages.add(message);

	const details: string[] = [];
	if (missing.size) {
		details.push(`is missing values for ${[...missing].join(', ')}`);
	}

	if (unused.length) {
		details.push(`has unused values ${unused.join(', ')}`);
	}

	console.warn(`localizedContent: message "${message}" ${details.join(' and ')}`);
}
