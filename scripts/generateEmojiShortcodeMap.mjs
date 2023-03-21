import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';
import LZString from 'lz-string';

async function generate() {
	/**
	 * @type {Map<string, string>}
	 */
	const shortcodeMap = new Map();

	// Get emoji data from https://github.com/milesj/emojibase
	// https://github.com/milesj/emojibase/

	const files = ['github.raw.json', 'emojibase.raw.json']; //, 'iamcal.raw.json', 'joypixels.raw.json'];

	for (const file of files) {
		/**
		 * @type {Record<string, string | string[]>}}
		 */
		const data = await downloadToJSON(
			`https://raw.githubusercontent.com/milesj/emojibase/master/packages/data/en/shortcodes/${file}`,
		);

		for (const [emojis, codes] of Object.entries(data)) {
			const emoji = emojis
				.split('-')
				.map(c => String.fromCodePoint(parseInt(c, 16)))
				.join('');
			for (const code of Array.isArray(codes) ? codes : [codes]) {
				if (shortcodeMap.has(code)) {
					// console.warn(`${file}: ${code}`);
					continue;
				}
				shortcodeMap.set(code, emoji);
			}
		}
	}

	// Get gitmoji data from https://github.com/carloscuesta/gitmoji
	// https://github.com/carloscuesta/gitmoji/blob/master/src/data/gitmojis.json
	/**
	 * @type {({ code: string; emoji: string })[]}
	 */
	const gitmojis = (
		await downloadToJSON(
			'https://raw.githubusercontent.com/carloscuesta/gitmoji/master/packages/gitmojis/src/gitmojis.json',
		)
	).gitmojis;

	for (const emoji of gitmojis) {
		if (emoji.code.startsWith(':') && emoji.code.endsWith(':')) {
			emoji.code = emoji.code.substring(1, emoji.code.length - 2);
		}

		if (shortcodeMap.has(emoji.code)) {
			// console.warn(`GitHub: ${emoji.code}`);
			continue;
		}
		shortcodeMap.set(emoji.code, emoji.emoji);
	}

	// Sort the emojis for easier diff checking
	const list = [...shortcodeMap.entries()];
	list.sort();

	const map = list.reduce((m, [key, value]) => {
		m[key] = value;
		return m;
	}, Object.create(null));

	fs.writeFileSync(
		path.join(process.cwd(), 'src/emojis.generated.ts'),
		`export const emojis = '${LZString.compressToBase64(JSON.stringify(map))}';\n`,
		'utf8',
	);
}

function downloadToJSON(url) {
	return new Promise(resolve => {
		https.get(url, rsp => {
			rsp.setEncoding('utf8');

			let data = '';
			rsp.on('data', chunk => (data += chunk));
			rsp.on('end', () => resolve(JSON.parse(data)));
		});
	});
}

void generate();
