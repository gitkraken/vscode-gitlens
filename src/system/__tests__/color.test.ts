import * as assert from 'assert';
import { suite, test } from 'mocha';
import { Color, formatRGB, formatRGBA, mix, opacity } from '../color';

suite('Color Test Suite', () => {
	test('hex to rgb', () => {
		assert.strictEqual(formatRGB(Color.from('#FFFFFF')), 'rgb(255, 255, 255)');
		assert.strictEqual(formatRGBA(Color.from('#FFFFFF')), 'rgba(255, 255, 255, 1)');
		assert.strictEqual(formatRGBA(Color.from('#FFFFFF20')), 'rgba(255, 255, 255, 0.13)');
		assert.strictEqual(formatRGBA(Color.from('#2f989b21')), 'rgba(47, 152, 155, 0.13)');
		assert.strictEqual(formatRGB(Color.from('#2f989b21')), 'rgba(47, 152, 155, 0.13)');
	});
	test('hsl to rgb', () => {
		// assert.strictEqual(formatRGB(Color.from('hsl(0deg 0% 100%)')), 'rgb(255, 255, 255)');
		assert.strictEqual(formatRGB(Color.from('hsl(0 0% 100%)')), 'rgb(255, 255, 255)');
	});
	test.skip('mix', () => {
		assert.strictEqual(mix('#FFFFFF', '#000000', 50), '#808080');
	});
	test('opacity', () => {
		assert.strictEqual(opacity('#FFFFFF', 50), 'rgba(255, 255, 255, 0.5)');
	});
});
