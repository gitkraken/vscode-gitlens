import * as assert from 'assert';
import * as vscodeL10n from '@vscode/l10n';
import { buildAriaLabel } from '../a11y.js';
import type { GraphCommit } from '../engine/types.js';
import type { GraphMessage } from '../l10n.js';
import * as l10n from '../l10n.js';
import { localizerGeneration, setMessageLocalizer } from '../l10n.js';
import { defaultZones } from '../zones.js';

suite('l10n — graph localizer', () => {
	teardown(() => {
		setMessageLocalizer(undefined);
		vscodeL10n.config({ contents: {} });
	});

	test('delegates to @vscode/l10n until a host sets a localizer', () => {
		vscodeL10n.config({ contents: { 'Hello {0}': 'Bonjour {0}', 'Open/A repository': 'Ouvrir' } });

		assert.strictEqual(l10n.t('Hello {0}', 'Ada'), 'Bonjour Ada');
		assert.strictEqual(l10n.t({ message: 'Open', comment: ['A repository'] }), 'Ouvrir');
	});

	test('a host localizer receives every call form in one shape, keyed like the bundle', () => {
		const seen: GraphMessage[] = [];
		setMessageLocalizer(message => {
			seen.push(message);
			return `<${message.key}>`;
		});

		assert.strictEqual(l10n.t('Hello {0} and {1}', 'Ada', 3), '<Hello Ada and 3>');
		assert.strictEqual(l10n.t('Hello {name}', { name: 'Ada' }), '<Hello Ada>');
		assert.strictEqual(
			l10n.t({ message: 'Open {0}', args: ['repo'], comment: ['A repository', ' tab'] }),
			'<Open repo/A repository tab>',
		);
		assert.strictEqual(l10n.t({ message: 'Close', comment: 'A tab' }), '<Close/A tab>');

		assert.deepStrictEqual(seen, [
			{ key: 'Hello {0} and {1}', message: 'Hello {0} and {1}', args: [] },
			{ key: 'Hello {name}', message: 'Hello {name}', args: {} },
			{
				key: 'Open {0}/A repository tab',
				message: 'Open {0}',
				args: [],
				comment: ['A repository', ' tab'],
			},
			{ key: 'Close/A tab', message: 'Close', args: {}, comment: ['A tab'] },
		]);
	});

	test('setting or clearing the localizer bumps the generation, and clearing restores the default', () => {
		const start = localizerGeneration();
		setMessageLocalizer(() => 'x');
		assert.strictEqual(localizerGeneration(), start + 1);
		assert.strictEqual(l10n.t('Message'), 'x');

		setMessageLocalizer(undefined);
		assert.strictEqual(localizerGeneration(), start + 2);
		assert.strictEqual(l10n.t('Message'), 'Message');
	});

	test('a row rendered again asks the host for nothing new, and a new localizer is used at once', () => {
		let calls = 0;
		setMessageLocalizer(message => {
			calls++;
			return `fr:${message.message}`;
		});
		const row: GraphCommit = {
			sha: '1234567890abcdef',
			shortSha: '1234567',
			message: 'Fixes the thing',
			author: 'Ada',
			authorEmail: 'ada@example.com',
			date: 0,
			parents: ['fedcba0987654321'],
			kind: 'commit',
		};

		const first = buildAriaLabel(row, 'commit', undefined, '3d');
		const callsAfterFirst = calls;
		assert.strictEqual(buildAriaLabel(row, 'commit', undefined, '3d'), first);
		assert.strictEqual(calls, callsAfterFirst);
		assert.ok(first.startsWith('fr:'));

		setMessageLocalizer(message => `de:${message.message}`);
		assert.ok(buildAriaLabel(row, 'commit', undefined, '3d').startsWith('de:'));
	});

	test('built-in labels read the localizer when used, not when imported', () => {
		setMessageLocalizer(message => `[${message.message}]`);

		assert.strictEqual(defaultZones.find(zone => zone.id === 'message')?.label, '[Message]');
	});
});
