/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const https = require('https');
const path = require('path');

async function generate() {
	/**
	 * @type {Record<string, string>}
	 */
	let map = Object.create(null);

	// Get emoji data from https://github.com/milesj/emojibase
	// https://github.com/milesj/emojibase/blob/master/packages/data/en/raw.json
	await download('https://raw.githubusercontent.com/milesj/emojibase/master/packages/data/en/raw.json', 'raw.json');

	/**
	 * @type {({ emoji: string; shortcodes: string[] })[]}
	 */
	// eslint-disable-next-line import/no-dynamic-require
	const emojis = require(path.join(process.cwd(), 'raw.json'));
	for (const emoji of emojis) {
		if (emoji.shortcodes == null || emoji.shortcodes.length === 0) continue;

		for (let code of emoji.shortcodes) {
			if (code.startsWith(':') && code.endsWith(':')) {
				code = code.substring(1, code.length - 2);
			}

			if (map[code] !== undefined) {
				console.warn(code);
			}
			map[code] = emoji.emoji;
		}
	}

	fs.unlink('raw.json', () => {});

	// Get gitmoji data from https://github.com/carloscuesta/gitmoji
	// https://github.com/carloscuesta/gitmoji/blob/master/src/data/gitmojis.json
	await download(
		'https://raw.githubusercontent.com/carloscuesta/gitmoji/master/src/data/gitmojis.json',
		'gitmojis.json',
	);

	/**
	 * @type {({ code: string; emoji: string })[]}
	 */
	// eslint-disable-next-line import/no-dynamic-require
	const gitmojis = require(path.join(process.cwd(), 'gitmojis.json')).gitmojis;
	for (const emoji of gitmojis) {
		if (emoji.code.startsWith(':') && emoji.code.endsWith(':')) {
			emoji.code = emoji.code.substring(1, emoji.code.length - 2);
		}

		if (map[emoji.code] !== undefined) {
			console.warn(emoji.code);
			continue;
		}
		map[emoji.code] = emoji.emoji;
	}

	fs.unlink('gitmojis.json', () => {});

	// Sort the emojis for easier diff checking
	/**
	 * @type { [string, string][] }}
	 */
	const list = Object.entries(map);
	list.sort();

	map = list.reduce((m, [key, value]) => {
		m[key] = value;
		return m;
	}, Object.create(null));

	fs.writeFileSync(path.join(process.cwd(), 'src/emojis.json'), JSON.stringify(map), 'utf8');
}

function download(url, destination) {
	return new Promise(resolve => {
		const stream = fs.createWriteStream(destination);
		https.get(url, rsp => {
			rsp.pipe(stream);
			stream.on('finish', () => {
				stream.close();
				resolve();
			});
		});
	});
}

void generate();
