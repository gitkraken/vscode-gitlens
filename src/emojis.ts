import emojis from './emojis.json';

const emojiRegex = /:([-+_a-z0-9]+):/g;

export function emojify(message: string) {
	return message.replace(emojiRegex, (s, code) => (emojis as Record<string, string>)[code] || s);
}
