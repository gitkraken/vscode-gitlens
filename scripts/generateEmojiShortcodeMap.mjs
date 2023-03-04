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
		await download(
			`https://raw.githubusercontent.com/milesj/emojibase/master/packages/data/en/shortcodes/${file}`,
			file,
		);

		/**
		 * @type {Record<string, string | string[]>}}
		 */
		const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), file), 'utf8'));
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

		fs.unlink(file, () => {});
	}

	// Get gitmoji data from https://github.com/carloscuesta/gitmoji
	// https://github.com/carloscuesta/gitmoji/blob/master/src/data/gitmojis.json
	await download(
		'https://raw.githubusercontent.com/carloscuesta/gitmoji/master/packages/gitmojis/src/gitmojis.json',
		'gitmojis.json',
	);

	/**
	 * @type {({ code: string; emoji: string })[]}
	 */
	const gitmojis = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'gitmojis.json'), 'utf8')).gitmojis;
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

	fs.unlink('gitmojis.json', () => {});

	// Sort the emojis for easier diff checking
	const list = [...shortcodeMap.entries()];
	list.sort();

	const map = list.reduce((m, [key, value]) => {
		m[key] = value;
		return m;
	}, Object.create(null));

	fs.writeFileSync(
		path.join(process.cwd(), 'src/emojis.compressed.ts'),
		`export const emojis = '${LZString.compressToBase64(JSON.stringify(map))}';\n`,
		'utf8',
	);
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
