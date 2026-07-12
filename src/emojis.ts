import { decompressFromBase64LZString } from '@gitlens/utils/string.js';
import { emojis as compressed } from './emojis.generated.js';

const emojiRegex = /(^|\s):([-+_a-z0-9]+):($|\s)/g;

let emojis: Record<string, string> | undefined = undefined;
export function emojify(message: string): string {
	// Cheap pre-check — this runs per commit message on every graph walk, and the regex machinery
	// costs far more than an indexOf on a message without any `:` at all.
	if (!message.includes(':')) return message;

	emojis ??= JSON.parse(decompressFromBase64LZString(compressed));
	return message.replace(emojiRegex, (s, $1, code, $3) => (emojis![code] ? `${$1}${emojis![code]}${$3}` : s));
}
