'use strict';
import * as emojis from './emojis.json';

const emojiMap = (emojis as any).default as Record<string, string>;
const emojiRegex = /:([-+_a-z0-9]+):/g;

export function emojify(message: string) {
	return message.replace(emojiRegex, (s, code) => {
		return emojiMap[code] || s;
	});
}
