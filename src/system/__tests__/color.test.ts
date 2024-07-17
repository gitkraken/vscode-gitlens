import * as assert from 'assert';
import { suite, test } from 'mocha';
import { Color, formatRGB, formatRGBA, mix, opacity, parseHexColor, RGBA } from '../color';

suite('Color Test Suite', () => {
	test.skip('hex to rgb: tricky string', () => {
		assert.strictEqual(parseHexColor('#QWERTY'), null);
		assert.strictEqual(parseHexColor('#wwwwww'), null);
	});
	test('hex to rgb', () => {
		assert.strictEqual(parseHexColor('123123'), null);
		assert.strictEqual(parseHexColor(''), null);
		assert.strictEqual(parseHexColor('#1'), null);
		assert.strictEqual(parseHexColor('#FFFFFF')?.equals(Color.white), true);
		assert.strictEqual(parseHexColor('#FFF')?.equals(Color.white), true);
		assert.strictEqual(parseHexColor('#FFFFFF00')?.toString(), 'rgba(255, 255, 255, 0)');
		assert.strictEqual(parseHexColor('#FFFFFFFF')?.equals(Color.white), true);
		assert.strictEqual(formatRGB(Color.from('#FFFFFF')), 'rgb(255, 255, 255)');
		assert.strictEqual(formatRGBA(Color.from('#FFFFFF')), 'rgba(255, 255, 255, 1)');
		assert.strictEqual(formatRGBA(Color.from('#FFFFFF20')), 'rgba(255, 255, 255, 0.13)');
		assert.strictEqual(formatRGBA(Color.from('#2f989b21')), 'rgba(47, 152, 155, 0.13)');
		assert.strictEqual(formatRGB(Color.from('#2f989b21')), 'rgba(47, 152, 155, 0.13)');
	});
	test.skip('hsl to rgb: deg', () => {
		// TODO: GitHub issue #3400: https://github.com/gitkraken/vscode-gitlens/issues/3400
		assert.strictEqual(formatRGB(Color.from('hsl(0deg 0% 100%)')), 'rgb(255, 255, 255)');
	});
	test('hsl to rgb', () => {
		assert.strictEqual(formatRGB(Color.from('hsl(0 0% 100%)')), 'rgb(255, 255, 255)');
	});
	test('mix', () => {
		assert.strictEqual(mix('#FFFFFF', '#000000', 50), '#808080');
	});
	test('opacity', () => {
		assert.strictEqual(opacity('#FFFFFF', 50), 'rgba(255, 255, 255, 0.5)');
	});
});
