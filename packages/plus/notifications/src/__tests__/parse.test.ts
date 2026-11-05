import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { parseNotification } from '../parse.js';

const createdAt = '2026-10-01T12:00:00Z';

function raw(overrides: Record<string, unknown>): Record<string, unknown> {
	return {
		notificationId: 'n1',
		name: 'Name',
		title: 'Title',
		notificationType: 'user',
		contentType: 'system',
		event: 'general',
		readAt: null,
		createdAt: createdAt,
		updatedAt: createdAt,
		fallback: '',
		payload: { markdown: 'Hello **world**' },
		...overrides,
	};
}

suite('parseNotification', () => {
	suite('general', () => {
		test('maps the identity, timestamps and markdown body', () => {
			const n = parseNotification(
				raw({ readAt: '2026-10-02T00:00:00Z', expiresAt: '2026-11-01T00:00:00Z', contentType: 'help' }),
			);
			assert.deepStrictEqual(n, {
				id: 'n1',
				event: 'general',
				contentType: 'help',
				headline: 'Title',
				body: 'Hello **world**',
				createdAt: Date.parse(createdAt),
				readAt: Date.parse('2026-10-02T00:00:00Z'),
				expiresAt: Date.parse('2026-11-01T00:00:00Z'),
			});
		});

		test('drops a missing or blank markdown', () => {
			assert.strictEqual(parseNotification(raw({ payload: {} })), undefined);
			assert.strictEqual(parseNotification(raw({ payload: { markdown: '   ' } })), undefined);
			assert.strictEqual(parseNotification(raw({ payload: { markdown: 42 } })), undefined);
			assert.strictEqual(parseNotification(raw({ payload: null })), undefined);
		});
	});

	suite('callToAction', () => {
		const payload = { markdown: 'Body', callToAction: { text: 'Review', link: 'https://gitkraken.dev/join' } };

		test('maps the CTA', () => {
			const n = parseNotification(raw({ event: 'callToAction', payload: payload }));
			assert.deepStrictEqual(n?.cta, { text: 'Review', url: 'https://gitkraken.dev/join' });
			assert.strictEqual(n?.body, 'Body');
		});

		test('drops a missing markdown, text or link', () => {
			assert.strictEqual(
				parseNotification(raw({ event: 'callToAction', payload: { ...payload, markdown: '' } })),
				undefined,
			);
			assert.strictEqual(
				parseNotification(
					raw({
						event: 'callToAction',
						payload: { markdown: 'Body', callToAction: { link: 'https://x.dev' } },
					}),
				),
				undefined,
			);
			assert.strictEqual(
				parseNotification(
					raw({ event: 'callToAction', payload: { markdown: 'Body', callToAction: { text: 'Go' } } }),
				),
				undefined,
			);
			assert.strictEqual(
				parseNotification(raw({ event: 'callToAction', payload: { markdown: 'Body' } })),
				undefined,
			);
		});

		test('drops a link that is not https', () => {
			for (const link of [
				'http://gitkraken.dev',
				'command:gitlens.showSettingsPage',
				'javascript:alert(1)',
				'file:///etc/passwd',
				'not a url',
			]) {
				assert.strictEqual(
					parseNotification(
						raw({
							event: 'callToAction',
							payload: { markdown: 'Body', callToAction: { text: 'Go', link: link } },
						}),
					),
					undefined,
					link,
				);
			}
		});
	});

	suite('projectShared', () => {
		const payload = {
			owner: { id: 'u1', name: 'Jane' },
			project: { id: 'p1', name: 'Platform' },
			organization: { id: 'o1', name: 'Acme' },
			shareType: 'org',
			teams: [{ id: 't1', name: 'Core' }, { id: 't2', name: 'Web' }, { id: 't3' }],
		};

		test('exposes the structured parts, with no body', () => {
			const n = parseNotification(raw({ event: 'projectShared', contentType: 'feature', payload: payload }));
			assert.deepStrictEqual(n?.projectShared, {
				organization: 'Acme',
				owner: 'Jane',
				project: 'Platform',
				teams: ['Core', 'Web'],
			});
			assert.strictEqual(n?.body, undefined);
		});

		test('treats missing teams as none', () => {
			const n = parseNotification(raw({ event: 'projectShared', payload: { ...payload, teams: null } }));
			assert.deepStrictEqual(n?.projectShared?.teams, []);
		});

		test('allows a missing headline (the host supplies one)', () => {
			const n = parseNotification(raw({ event: 'projectShared', title: '', name: ' ', payload: payload }));
			assert.strictEqual(n?.headline, undefined);
		});

		test('drops a missing organization, owner or project name', () => {
			for (const key of ['organization', 'owner', 'project']) {
				assert.strictEqual(
					parseNotification(raw({ event: 'projectShared', payload: { ...payload, [key]: { id: 'x' } } })),
					undefined,
					key,
				);
			}
		});
	});

	suite('nudge', () => {
		test('uses the metadata message as the body', () => {
			const n = parseNotification(
				raw({ event: 'nudge', payload: { metadata: { message: 'Take a look' }, initiatorUserId: 'u2' } }),
			);
			assert.strictEqual(n?.body, 'Take a look');
		});

		test('drops a missing message', () => {
			assert.strictEqual(parseNotification(raw({ event: 'nudge', payload: { metadata: {} } })), undefined);
			assert.strictEqual(parseNotification(raw({ event: 'nudge', payload: {} })), undefined);
		});
	});

	suite('unknown events', () => {
		test('shows the fallback and flags that a newer version is needed', () => {
			const n = parseNotification(raw({ event: 'organizationInviteAccepted', fallback: 'Someone joined' }));
			assert.strictEqual(n?.event, 'unknown');
			assert.strictEqual(n?.body, 'Someone joined');
			assert.strictEqual(n?.needsNewerVersion, true);
		});

		test('drops one with no fallback', () => {
			assert.strictEqual(
				parseNotification(raw({ event: 'organizationInviteAccepted', fallback: '' })),
				undefined,
			);
			assert.strictEqual(
				parseNotification(raw({ event: 'organizationInviteAccepted', fallback: null })),
				undefined,
			);
			assert.strictEqual(parseNotification(raw({ event: undefined })), undefined);
		});

		test('does not use the fallback for a known event with a malformed payload', () => {
			assert.strictEqual(parseNotification(raw({ payload: {}, fallback: 'Fallback' })), undefined);
		});
	});

	suite('headline', () => {
		test('uses the trimmed title', () => {
			assert.strictEqual(parseNotification(raw({ title: '  Title  ' }))?.headline, 'Title');
		});

		test('is undefined when the title is missing or blank, and never uses the name', () => {
			assert.strictEqual(parseNotification(raw({ title: undefined }))?.headline, undefined);
			assert.strictEqual(parseNotification(raw({ title: '  ' }))?.headline, undefined);
			assert.strictEqual(parseNotification(raw({ title: '', name: 'Name' }))?.headline, undefined);
		});

		test('keeps a notification with no title', () => {
			const n = parseNotification(raw({ title: '', name: '' }));
			assert.notStrictEqual(n, undefined);
			assert.strictEqual(n?.headline, undefined);
		});

		test('summary prefers the payload desktopMessage over the fallback', () => {
			const n = parseNotification(
				raw({ fallback: 'Fallback', payload: { markdown: 'Hello', desktopMessage: 'Desktop' } }),
			);
			assert.strictEqual(n?.summary, 'Desktop');
		});

		test('summary falls back to the fallback', () => {
			assert.strictEqual(parseNotification(raw({ fallback: 'Fallback' }))?.summary, 'Fallback');
			assert.strictEqual(
				parseNotification(raw({ fallback: 'Fallback', payload: { markdown: 'Hello', desktopMessage: '  ' } }))
					?.summary,
				'Fallback',
			);
		});

		test('summary converts a markdown fallback to plain text', () => {
			assert.strictEqual(
				parseNotification(raw({ fallback: 'Your **poll** has [results](https://example.com/p).' }))?.summary,
				'Your poll has results.',
			);
		});

		test('summary is trimmed', () => {
			assert.strictEqual(parseNotification(raw({ fallback: '  Summary  ' }))?.summary, 'Summary');
			assert.strictEqual(
				parseNotification(raw({ payload: { markdown: 'Hello', desktopMessage: '  Desktop  ' } }))?.summary,
				'Desktop',
			);
		});

		test('summary is absent when both are blank', () => {
			const n = parseNotification(raw({ fallback: '   ', payload: { markdown: 'Hello', desktopMessage: '' } }));
			assert.notStrictEqual(n, undefined);
			assert.strictEqual('summary' in (n ?? {}), false);
		});

		test('summary ignores a non-string desktopMessage', () => {
			assert.strictEqual(
				parseNotification(raw({ fallback: 'Fallback', payload: { markdown: 'Hello', desktopMessage: 42 } }))
					?.summary,
				'Fallback',
			);
		});
	});

	suite('malformed input', () => {
		test('drops non-objects', () => {
			assert.strictEqual(parseNotification(undefined), undefined);
			assert.strictEqual(parseNotification('n1'), undefined);
			assert.strictEqual(parseNotification([]), undefined);
		});

		test('drops a missing id or an invalid createdAt', () => {
			assert.strictEqual(parseNotification(raw({ notificationId: '' })), undefined);
			assert.strictEqual(parseNotification(raw({ createdAt: 'yesterday' })), undefined);
		});

		test('shows an unknown content type as a feature notification', () => {
			assert.strictEqual(parseNotification(raw({ contentType: 'news' }))?.contentType, 'feature');
		});

		test('treats unparseable optional timestamps as absent', () => {
			const n = parseNotification(raw({ readAt: 'nope', expiresAt: 'nope' }));
			assert.strictEqual(n?.readAt, undefined);
			assert.strictEqual(n?.expiresAt, undefined);
		});

		test('logs why a notification was dropped', () => {
			const warnings: string[] = [];
			parseNotification(raw({ createdAt: 'yesterday' }), { warn: m => warnings.push(m) });
			assert.deepStrictEqual(warnings, ['Dropped notification n1: invalid createdAt']);
		});
	});
});
