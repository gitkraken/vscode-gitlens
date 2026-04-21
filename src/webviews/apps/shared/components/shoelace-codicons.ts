import { registerIconLibrary } from '@shoelace-style/shoelace/dist/utilities/icon-library.js';

const codiconPaths: Record<string, string> = {
	'chevron-down':
		'm3.146 5.854 4.5 4.5a.5.5 0 0 0 .707 0l4.5-4.5a.5.5 0 0 0-.707-.707L8 9.293 3.854 5.147a.5.5 0 0 0-.708.707Z',
	'chevron-left':
		'm9.146 3.146-4.5 4.5a.5.5 0 0 0 0 .707l4.5 4.5a.5.5 0 0 0 .707-.707L5.707 8l4.146-4.146a.5.5 0 0 0-.707-.707Z',
	'chevron-right':
		'M6.146 3.146a.5.5 0 0 0 0 .707L10.293 8l-4.146 4.146a.5.5 0 0 0 .707.707l4.5-4.5a.5.5 0 0 0 0-.707l-4.5-4.5a.5.5 0 0 0-.708 0Z',
	check: 'M13.657 3.136a.5.5 0 0 1 .686.728l-8.5 8a.5.5 0 0 1-.697-.01l-3.5-3.5a.5.5 0 1 1 .708-.708l3.156 3.157 8.147-7.667Z',
	radio: 'M8 4c.367 0 .721.048 1.063.145a3.943 3.943 0 0 1 1.762 1.031 3.944 3.944 0 0 1 1.03 1.762c.097.34.145.695.145 1.062 0 .367-.048.721-.145 1.063a3.94 3.94 0 0 1-1.03 1.765 4.017 4.017 0 0 1-1.762 1.031C8.72 11.953 8.367 12 8 12s-.721-.047-1.063-.14a4.056 4.056 0 0 1-1.765-1.032A4.055 4.055 0 0 1 4.14 9.062 3.992 3.992 0 0 1 4 8c0-.367.047-.721.14-1.063.097-.34.232-.658.407-.953A4.089 4.089 0 0 1 5.98 4.546a3.94 3.94 0 0 1 .957-.401A3.89 3.89 0 0 1 8 4Z',
	'x-circle-fill':
		'm8.707 8 3.646-3.646a.5.5 0 0 0-.707-.707L8 7.293 4.354 3.647a.5.5 0 0 0-.707.707L7.293 8l-3.646 3.646a.5.5 0 0 0 .708.707l3.646-3.646 3.646 3.646a.498.498 0 0 0 .708 0 .5.5 0 0 0 0-.707L8.709 8h-.002Z',
};

const spriteId = 'gl-shoelace-codicons';
const symbolPrefix = 'gl-shoelace-codicon-';

let registered = false;
function ensureSpriteSheet(): void {
	if (document.getElementById(spriteId) != null) return;

	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.id = spriteId;
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');

	for (const [name, d] of Object.entries(codiconPaths)) {
		const symbol = document.createElementNS('http://www.w3.org/2000/svg', 'symbol');
		symbol.id = `${symbolPrefix}${name}`;
		symbol.setAttribute('viewBox', '0 0 16 16');
		symbol.setAttribute('fill', 'currentColor');
		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('d', d);
		symbol.appendChild(path);
		svg.appendChild(symbol);
	}

	const target = document.body ?? document.documentElement;
	if (target.firstChild != null) {
		target.insertBefore(svg, target.firstChild);
	} else {
		target.appendChild(svg);
	}
}

function register(): void {
	if (registered) return;
	registered = true;
	registerIconLibrary('system', {
		resolver: name => (codiconPaths[name] != null ? `#${symbolPrefix}${name}` : ''),
		spriteSheet: true,
	});
	if (document.body != null) {
		ensureSpriteSheet();
	} else {
		document.addEventListener('DOMContentLoaded', () => ensureSpriteSheet(), { once: true });
	}
}

register();
