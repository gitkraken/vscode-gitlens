import * as assert from 'assert';
import { formatPlural, getPluralCategory, setPluralLocale } from '../plural.js';

function withWarnings(run: () => void): unknown[][] {
	const warnings: unknown[][] = [];
	const original = console.warn;
	console.warn = (...args: unknown[]) => warnings.push(args);
	try {
		run();
	} finally {
		console.warn = original;
	}
	return warnings;
}

suite('Plural Test Suite', () => {
	teardown(() => {
		setPluralLocale(undefined);
	});

	suite('formatPlural', () => {
		test('resolves a block by CLDR category, positionally', () => {
			const template = '{0, plural, one{{0} file changed} other{{0} files changed}}';
			assert.strictEqual(formatPlural(template, [1]), '1 file changed');
			assert.strictEqual(formatPlural(template, [0]), '0 files changed');
			assert.strictEqual(formatPlural(template, [2]), '2 files changed');
		});

		test('resolves a block by CLDR category, by name', () => {
			const template = '{count, plural, one{{count} file changed} other{{count} files changed}}';
			assert.strictEqual(formatPlural(template, { count: 1 }), '1 file changed');
			assert.strictEqual(formatPlural(template, { count: 3 }), '3 files changed');
		});

		test('an exact "=N" branch wins over the CLDR category', () => {
			const template = '{0, plural, =0{no files changed} one{{0} file changed} other{{0} files changed}}';
			assert.strictEqual(formatPlural(template, [0]), 'no files changed');
			assert.strictEqual(formatPlural(template, [1]), '1 file changed');
			assert.strictEqual(formatPlural(template, [5]), '5 files changed');
		});

		test('resolves two sibling blocks in one template', () => {
			const template =
				'{0, plural, one{{0} file} other{{0} files}} changed, {1, plural, one{{1} line} other{{1} lines}} added';
			assert.strictEqual(formatPlural(template, [2, 1]), '2 files changed, 1 line added');
			assert.strictEqual(formatPlural(template, [1, 5]), '1 file changed, 5 lines added');
		});

		test('fr categorizes both 0 and 1 as "one"', () => {
			setPluralLocale('fr');
			const template = '{0, plural, one{{0} fichier modifié} other{{0} fichiers modifiés}}';
			assert.strictEqual(getPluralCategory(0), 'one');
			assert.strictEqual(getPluralCategory(1), 'one');
			assert.strictEqual(formatPlural(template, [0]), '0 fichier modifié');
			assert.strictEqual(formatPlural(template, [1]), '1 fichier modifié');
			assert.strictEqual(formatPlural(template, [2]), '2 fichiers modifiés');
		});

		test('ru resolves one/few/many/other across 1, 2, 5, 11, 21, 101', () => {
			setPluralLocale('ru');
			const template =
				'{0, plural, one{{0} файл изменён} few{{0} файла изменено} many{{0} файлов изменено} other{{0} файлов изменено}}';
			assert.strictEqual(formatPlural(template, [1]), '1 файл изменён');
			assert.strictEqual(formatPlural(template, [2]), '2 файла изменено');
			assert.strictEqual(formatPlural(template, [5]), '5 файлов изменено');
			assert.strictEqual(formatPlural(template, [11]), '11 файлов изменено');
			assert.strictEqual(formatPlural(template, [21]), '21 файл изменён');
			assert.strictEqual(formatPlural(template, [101]), '101 файл изменён');
		});

		test('a numeric arg is rendered through getNumericFormat, not a bare String()', () => {
			// 1234 only round-trips as "1,234" (this environment's default locale groups thousands) if
			// formatPlural is really calling getNumericFormat() rather than just stringifying the number.
			const template = '{0, plural, one{{0} file changed} other{{0} files changed}}';
			assert.strictEqual(formatPlural(template, [1234]), '1,234 files changed');
		});

		test('setPluralLocale(undefined) resets to English', () => {
			setPluralLocale('ru');
			setPluralLocale(undefined);
			assert.strictEqual(getPluralCategory(1), 'one');
			assert.strictEqual(getPluralCategory(2), 'other');
		});

		test('resolves a block nested inside another block’s branch (ru)', () => {
			setPluralLocale('ru');
			const aheadBlock =
				'{aheadCount, plural, one{{aheadCount} коммит впереди} few{{aheadCount} коммита впереди} many{{aheadCount} коммитов впереди} other{{aheadCount} коммитов впереди}}';
			const template =
				'{behindCount, plural, ' +
				`one{{behindCount} коммит позади, ${aheadBlock}} ` +
				`few{{behindCount} коммита позади, ${aheadBlock}} ` +
				`many{{behindCount} коммитов позади, ${aheadBlock}} ` +
				`other{{behindCount} коммитов позади, ${aheadBlock}}` +
				'}';
			assert.strictEqual(
				formatPlural(template, { behindCount: 1, aheadCount: 5 }),
				'1 коммит позади, 5 коммитов впереди',
			);
			assert.strictEqual(
				formatPlural(template, { behindCount: 2, aheadCount: 21 }),
				'2 коммита позади, 21 коммит впереди',
			);
		});

		test('a non-number selector value falls back to "other" and warns once', () => {
			const template = '{status, plural, one{one thing} other{{status} things}}';
			let result1 = '';
			let result2 = '';
			const warnings = withWarnings(() => {
				result1 = formatPlural(template, { status: 'active' });
				result2 = formatPlural(template, { status: 'active' });
			});
			assert.strictEqual(result1, 'active things');
			assert.strictEqual(result2, 'active things');
			assert.strictEqual(warnings.length, 1);
		});

		test('a malformed block is left untouched, warns once, and a later plain placeholder still substitutes', () => {
			const template = 'prefix {0, plural, one{{0} file} suffix {1} tail';
			// The broken block's own "{0}" is trapped inside the unparsed span and comes back verbatim; the
			// unrelated "{1}" that follows it is plain text and still gets substituted normally.
			const expected = 'prefix {0, plural, one{{0} file} suffix x tail';
			let result1 = '';
			let result2 = '';
			const warnings = withWarnings(() => {
				result1 = formatPlural(template, [2, 'x']);
				result2 = formatPlural(template, [2, 'x']);
			});
			assert.strictEqual(result1, expected);
			assert.strictEqual(result2, expected);
			assert.strictEqual(warnings.length, 1);
		});

		test('defaults args to an empty list', () => {
			assert.strictEqual(formatPlural('no placeholders here'), 'no placeholders here');
		});
	});
});
