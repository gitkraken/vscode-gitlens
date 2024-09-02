/**
 * escapes markdown code blocks
 */
function escapeTripleBackticks(s: string) {
	const tripleBackticks = '```';
	const escapedTripleBackticks = '\\`\\`\\`';
	let str = '';
	let allowed = true;
	let quotesOpened = false;
	let buffer = '';

	for (let i = 0; i < s.length; i += 1) {
		const char = s[i];
		const chain = s.substring(i, i + 3);
		if (char === '\n' && quotesOpened) {
			allowed = false;
		}
		if (chain === tripleBackticks) {
			if (quotesOpened) {
				quotesOpened = false;
				if (allowed) {
					str += `${tripleBackticks}${buffer}${tripleBackticks}`;
				} else {
					str += `${escapedTripleBackticks}${buffer}${escapedTripleBackticks}`;
					allowed = true;
				}
				buffer = '';
			} else {
				quotesOpened = true;
			}
			// skip chain
			i += 2;
			continue;
		}
		if (quotesOpened) {
			buffer += char;
		} else {
			str += char;
		}
	}
	return str;
}

export { escapeTripleBackticks };
