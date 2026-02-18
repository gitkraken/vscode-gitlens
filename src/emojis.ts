import { emojis as compressed } from './emojis.generated.js';
import { decompressFromBase64LZString } from './system/string.js';

const emojiRegex = /(^|\s):([-+_a-z0-9]+):($|\s)/g;

let emojis: Record<string, string> | undefined = undefined;
export function emojify(message: string): string {
	emojis ??= JSON.parse(decompressFromBase64LZString(compressed));
	return message.replace(emojiRegex, (s, $1, code, $3) => (emojis![code] ? `${$1}${emojis![code]}${$3}` : s));
}
