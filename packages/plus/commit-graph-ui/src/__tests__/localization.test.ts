import * as assert from 'assert';
import * as l10n from '@gitkraken/commit-graph/l10n.js';
import { formatPlural, getPluralCategory, getPluralLocale } from '@gitlens/utils/plural.js';
import { connectedGraphs } from '../connectedGraphs.js';
import { formatGraphMessage, setGraphLocalizer } from '../localization.js';

suite('commit graph localization', () => {
	teardown(() => setGraphLocalizer(undefined));

	test('a plural template is translated by the host and resolved by the graph', () => {
		const catalog: Record<string, string> = {
			'{0, plural, one{{0} file changed} other{{0} files changed}}':
				'{0, plural, one{{0} fichier modifié} other{{0} fichiers modifiés}}',
		};
		setGraphLocalizer(message => formatGraphMessage(catalog[message.key] ?? message.message, message.args), {
			locale: 'fr',
		});

		assert.strictEqual(
			formatPlural(l10n.t('{0, plural, one{{0} file changed} other{{0} files changed}}'), [0]),
			'0 fichier modifié',
		);
		assert.strictEqual(
			formatPlural(l10n.t('{0, plural, one{{0} file changed} other{{0} files changed}}'), [3]),
			'3 fichiers modifiés',
		);
	});

	test('the locale option drives plural rules and list locale, and clearing it restores the default', () => {
		setGraphLocalizer(message => message.message, { locale: 'fr' });
		assert.strictEqual(getPluralCategory(0), 'one');
		assert.strictEqual(getPluralLocale(), 'fr');

		setGraphLocalizer(undefined);
		assert.strictEqual(getPluralCategory(0), 'other');
		assert.strictEqual(getPluralLocale(), undefined);
	});

	test('switching the localizer redraws every connected graph', () => {
		let updates = 0;
		const graph = { requestUpdate: () => void updates++ };
		connectedGraphs.add(graph);
		try {
			setGraphLocalizer(message => message.message, { locale: 'fr' });
			setGraphLocalizer(undefined);
		} finally {
			connectedGraphs.delete(graph);
		}
		assert.strictEqual(updates, 2);
	});

	test('formatGraphMessage substitutes like @vscode/l10n', () => {
		assert.strictEqual(formatGraphMessage('{0} of {1}', [2, 5]), '2 of 5');
		assert.strictEqual(formatGraphMessage('Hi {name}, {missing}', { name: 'Ada' }), 'Hi Ada, {missing}');
		assert.strictEqual(formatGraphMessage('{0, plural, one{#} other{#}}', []), '{0, plural, one{#} other{#}}');
	});
});
