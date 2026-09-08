/**
 * Inserts existing Lit content at named placeholders in translated prose. The result is rendered
 * through a normal Lit child binding, so translations remain text and cannot create markup.
 * Pass a literal `l10n.t('... {name} ...')` message; leave its placeholders for this function.
 */
export function localizedContent(message: string, values: Readonly<Record<string, unknown>>): unknown[] {
	return message.split(/(\{[^{}]+\})/g).map(part => {
		if (!part.startsWith('{') || !part.endsWith('}')) return part;

		const key = part.slice(1, -1);
		return Object.hasOwn(values, key) ? values[key] : part;
	});
}
