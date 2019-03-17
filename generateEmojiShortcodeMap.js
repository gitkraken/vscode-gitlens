const fs = require('fs');
const https = require('https');
const path = require('path');

async function generate() {
    let map = Object.create(null);

    // Get emoji data from https://github.com/milesj/emojibase
    // https://github.com/milesj/emojibase/blob/master/packages/data/en/raw.json
    await download('https://raw.githubusercontent.com/milesj/emojibase/master/packages/data/en/raw.json', 'raw.json');

    const emojis = require(path.join(process.cwd(), 'raw.json'));
    for (const emoji of emojis) {
        if (emoji.shortcodes == null || emoji.shortcodes.length === 0) continue;

        for (const code of emoji.shortcodes) {
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
        'gitmojis.json'
    );

    const gitmojis = require(path.join(process.cwd(), 'gitmojis.json')).gitmojis;
    for (const emoji of gitmojis) {
        if (map[emoji.code] !== undefined) {
            console.warn(emoji.code);
            continue;
        }
        map[emoji.code] = emoji.emoji;
    }

    fs.unlink('gitmojis.json', () => {});

    // Sort the emojis for easier diff checking
    const list = Object.entries(map);
    list.sort();

    map = list.reduce((m, [key, value]) => {
        m[key] = value;
        return m;
    }, Object.create(null));

    fs.writeFileSync(path.join(process.cwd(), 'src/emojis.json'), JSON.stringify(map), 'utf8');
}

function download(url, destination) {
    return new Promise((resolve, reject) => {
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

generate();
