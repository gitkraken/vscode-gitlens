import { emojis as compressed } from './emojis.generated';
import { decompressFromBase64LZString } from './system/string';

const emojiRegex = /:([-+_a-z0-9]+):/g;

let emojis: Record<string, string> | undefined = undefined;
export function emojify(message: string) {
	if (emojis == null) {
		emojis = JSON.parse(decompressFromBase64LZString(compressed));
	}
	return message.replace(emojiRegex, (s, code) => emojis![code] || s);
}
