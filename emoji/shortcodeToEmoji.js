const fs = require('fs');
const path = require('path');

// Get emoji data from https://github.com/milesj/emojibase
// https://github.com/milesj/emojibase/blob/master/packages/data/en/data.json

function generate() {
    const map = Object.create(null);

    const emojis = require(path.join(process.cwd(), 'data.json'));
    for (const emoji of emojis) {
        if (emoji.shortcodes == null || emoji.shortcodes.length === 0) continue;

        for (const code of emoji.shortcodes) {
            if (map[code] !== undefined) {
                console.warn(code);
            }
            map[code] = emoji.emoji;
        }
    }

    fs.writeFileSync(path.join(process.cwd(), 'emojis.json'), JSON.stringify(map), 'utf8');
}

generate();
