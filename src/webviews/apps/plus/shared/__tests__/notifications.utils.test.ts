import * as assert from 'assert';
import { html } from 'lit';
import type { GkNotification, ProjectSharedDetails } from '@gitlens/notifications/models.js';
import {
	formatProjectSharedBody,
	getNeedsNewerVersionText,
	getNotificationBodyText,
	getNotificationHeadline,
	getNotificationSender,
	isTextTruncated,
} from '../notifications.utils.js';

function createNotification(overrides?: Partial<GkNotification>): GkNotification {
	return {
		id: 'n1',
		event: 'general',
		contentType: 'feature',
		body: undefined,
		createdAt: 0,
		...overrides,
	};
}

function createShared(teams: string[]): ProjectSharedDetails {
	return { organization: 'Acme', owner: 'Ada', project: 'Rocket', teams: teams };
}

suite('notifications.utils', () => {
	suite('getNotificationHeadline', () => {
		test('uses the title', () => {
			assert.strictEqual(
				getNotificationHeadline(createNotification({ headline: 'Title', summary: 'Summary' })),
				'Title',
			);
		});

		test('falls back to the summary', () => {
			assert.strictEqual(getNotificationHeadline(createNotification({ summary: 'Summary' })), 'Summary');
		});

		test('names a Team Workspace share that has no title', () => {
			assert.strictEqual(
				getNotificationHeadline(
					createNotification({ event: 'projectShared', projectShared: createShared([]) }),
				),
				'Team Workspace shared',
			);
		});

		test('is undefined when there is nothing to head the notification with', () => {
			assert.strictEqual(getNotificationHeadline(createNotification({ body: 'Some body' })), undefined);
		});
	});

	suite('getNotificationBodyText', () => {
		test('builds the Team Workspace sentence', () => {
			assert.strictEqual(
				getNotificationBodyText(
					createNotification({ event: 'projectShared', projectShared: createShared([]) }),
				),
				'In Acme, Ada created a new Team Workspace: Rocket',
			);
		});

		test('lists the teams a Team Workspace was shared with', () => {
			assert.strictEqual(
				getNotificationBodyText(
					createNotification({ event: 'projectShared', projectShared: createShared(['Core', 'Web']) }),
				),
				'In Acme, Ada created a new Team Workspace: Rocket with Core and Web',
			);
		});

		test('drops a first paragraph that only repeats the header', () => {
			assert.strictEqual(
				getNotificationBodyText(
					createNotification({ headline: 'Big news', body: '**Big news.**\n\nThe details follow.' }),
				),
				'The details follow.',
			);
		});

		test('keeps a first paragraph that differs from the header', () => {
			assert.strictEqual(
				getNotificationBodyText(createNotification({ headline: 'Big news', body: 'Other news\n\nMore.' })),
				'Other news More.',
			);
		});

		test('flattens markdown to one line of text', () => {
			assert.strictEqual(
				getNotificationBodyText(
					createNotification({
						body: '# Heading\n\nSee [the docs](https://example.com) for `snake_case` *now*',
					}),
				),
				'Heading See the docs for snake_case now',
			);
		});

		test('falls back to the needs-newer-version note when there is no body', () => {
			assert.strictEqual(
				getNotificationBodyText(createNotification({ event: 'unknown', needsNewerVersion: true })),
				getNeedsNewerVersionText(),
			);
		});

		test('falls back to the note when the body only repeats the header', () => {
			assert.strictEqual(
				getNotificationBodyText(
					createNotification({
						event: 'unknown',
						headline: 'Update',
						body: 'Update',
						needsNewerVersion: true,
					}),
				),
				getNeedsNewerVersionText(),
			);
		});

		test('is undefined when there is nothing to show', () => {
			assert.strictEqual(getNotificationBodyText(createNotification({ body: '  ' })), undefined);
		});
	});

	suite('formatProjectSharedBody', () => {
		test('places markup as a part of its own', () => {
			const project = html`<strong>Rocket</strong>`;
			const parts = formatProjectSharedBody(createShared([]), project);
			assert.deepStrictEqual(parts, ['In ', 'Acme', ', ', 'Ada', ' created a new Team Workspace: ', project, '']);
		});
	});

	suite('shared copy', () => {
		test('the sender is the product name, never localized', () => {
			assert.strictEqual(getNotificationSender(), 'GitKraken');
		});

		test('the needs-newer-version note', () => {
			assert.strictEqual(getNeedsNewerVersionText(), 'This notification needs a newer version of GitLens.');
		});
	});
	suite('isTextTruncated', () => {
		test('is false when the text fits', () => {
			assert.strictEqual(
				isTextTruncated({ clientHeight: 20, clientWidth: 100, scrollHeight: 20, scrollWidth: 100 }),
				false,
			);
		});

		test('ignores a sub-pixel difference', () => {
			assert.strictEqual(
				isTextTruncated({ clientHeight: 20, clientWidth: 100, scrollHeight: 21, scrollWidth: 101 }),
				false,
			);
		});

		test('is true when an ellipsis cuts the width', () => {
			assert.strictEqual(
				isTextTruncated({ clientHeight: 20, clientWidth: 100, scrollHeight: 20, scrollWidth: 180 }),
				true,
			);
		});

		test('is true when a line clamp cuts the height', () => {
			assert.strictEqual(
				isTextTruncated({ clientHeight: 40, clientWidth: 100, scrollHeight: 60, scrollWidth: 100 }),
				true,
			);
		});
	});
});
