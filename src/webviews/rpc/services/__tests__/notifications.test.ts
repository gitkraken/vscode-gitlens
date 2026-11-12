import * as assert from 'assert';
import { EventEmitter } from 'vscode';
import { AuthenticationError, AuthenticationErrorReason } from '@gitlens/git/errors.js';
import { NotificationsApiError } from '@gitlens/notifications/errors.js';
import type { NotificationsState } from '@gitlens/notifications/models.js';
import type { NotificationsService as GkNotificationsService } from '@gitlens/notifications/notificationsService.js';
import { CancellationError } from '@gitlens/utils/cancellation.js';
import type { Container } from '../../../../container.js';
import {
	AuthenticationRequiredError,
	RequestRateLimitError,
	RequestsAreBlockedTemporarilyError,
} from '../../../../errors.js';
import type { NotificationsController } from '../../../../plus/notifications/notificationsController.js';
import { NotificationsRpcService } from '../notifications.js';

const emptyState: NotificationsState = {
	items: [],
	hasMore: false,
	status: 'ready',
	lastSyncedAt: undefined,
	settings: undefined,
	unreadCount: 0,
};

/** The controller surface the RPC service reads, with the inbox-visibility owners it was told about */
class FakeController {
	readonly visibleInboxes = new Set<object>();
	readonly changed = new EventEmitter<void>();
	readonly onDidChange = this.changed.event;
	available = true;
	service: GkNotificationsService | undefined;
	inboxId = 0;
	focusNotificationId: string | undefined;

	setInboxVisible(owner: object, visible: boolean): void {
		if (visible) {
			this.visibleInboxes.add(owner);
		} else {
			this.visibleInboxes.delete(owner);
		}
	}
}

function createService(markRead: GkNotificationsService['markRead']): GkNotificationsService {
	return { getState: () => emptyState, markRead: markRead } as unknown as GkNotificationsService;
}

suite('NotificationsRpcService', () => {
	let controller: FakeController;
	let visibility: EventEmitter<boolean>;
	let connected: EventEmitter<void>;
	let rpc: NotificationsRpcService;

	setup(() => {
		controller = new FakeController();
		visibility = new EventEmitter<boolean>();
		connected = new EventEmitter<void>();
		rpc = new NotificationsRpcService(
			{ notifications: controller as unknown as NotificationsController } as unknown as Container,
			{ onDidChangeVisibility: visibility.event, onDidConnect: connected.event },
			undefined,
		);
	});

	teardown(() => {
		rpc.dispose();
		controller.changed.dispose();
		visibility.dispose();
		connected.dispose();
	});

	suite('request errors', () => {
		test('rejects when there is no service', async () => {
			controller.service = undefined;
			await assert.rejects(rpc.markRead(['n1']), { message: 'Notifications are not available' });
		});

		test('replaces an API error with a generic message, keeping it as the cause', async () => {
			const apiError = new NotificationsApiError(500, 'markRead');
			controller.service = createService(() => Promise.reject(apiError));

			await assert.rejects(rpc.markRead(['n1']), (ex: Error) => {
				assert.strictEqual(ex.message, "GitKraken couldn't complete the request. Please try again.");
				assert.strictEqual(ex.cause, apiError);
				return true;
			});
		});

		const failures: [string, () => Error, string][] = [
			[
				'a 401 response',
				() => new NotificationsApiError(401, 'markRead'),
				'Your GitKraken session has expired. Please sign in again.',
			],
			[
				'a 429 response',
				() => new NotificationsApiError(429, 'markRead'),
				'Too many requests to GitKraken. Please try again in a few minutes.',
			],
			[
				'a 503 response',
				() => new NotificationsApiError(503, 'markRead'),
				'GitKraken is temporarily unavailable. Please try again in a few minutes.',
			],
			[
				'a missing session',
				() => new AuthenticationRequiredError(),
				'Your GitKraken session has expired. Please sign in again.',
			],
			[
				'requests being blocked',
				() => new RequestsAreBlockedTemporarilyError(),
				'GitKraken is temporarily unavailable. Please try again in a few minutes.',
			],
			[
				'a rate limit',
				() => new RequestRateLimitError(new Error('rate limit exceeded'), undefined, undefined),
				'Too many requests to GitKraken. Please try again in a few minutes.',
			],
			[
				'an authentication error',
				() =>
					new AuthenticationError(
						{ providerId: 'gitkraken', cloud: true, type: undefined },
						AuthenticationErrorReason.Unauthorized,
					),
				'Your GitKraken session has expired. Please sign in again.',
			],
			[
				'a refused request',
				() =>
					new AuthenticationError(
						{ providerId: 'gitkraken', cloud: true, type: undefined },
						AuthenticationErrorReason.Forbidden,
					),
				"GitKraken couldn't complete the request. Please try again.",
			],
			[
				'a failed fetch',
				() => new TypeError('fetch failed'),
				"Couldn't reach GitKraken. Check your connection and try again.",
			],
			[
				"the browser's failed fetch",
				() => new TypeError('Failed to fetch'),
				"Couldn't reach GitKraken. Check your connection and try again.",
			],
			[
				'a request timeout',
				() => new CancellationError(),
				"Couldn't reach GitKraken. Check your connection and try again.",
			],
			[
				'a network error code',
				() => Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
				"Couldn't reach GitKraken. Check your connection and try again.",
			],
			['an unknown error', () => new Error('boom'), 'Something went wrong. Please try again.'],
		];

		failures.forEach(([name, create, expected]) => {
			test(`maps ${name} to a localized message, keeping it as the cause`, async () => {
				const error = create();
				controller.service = createService(() => Promise.reject(error));

				await assert.rejects(rpc.markRead(['n1']), (ex: Error) => {
					assert.strictEqual(ex.message, expected);
					assert.strictEqual(ex.cause, error);
					return true;
				});
			});
		});
	});

	suite('inbox visibility', () => {
		setup(async () => {
			await rpc.setInboxVisible(true);
			assert.ok(controller.visibleInboxes.has(rpc));
		});

		test('clears when the webview hides', () => {
			visibility.fire(true);
			assert.ok(controller.visibleInboxes.has(rpc));

			visibility.fire(false);
			assert.ok(!controller.visibleInboxes.has(rpc));
		});

		test('clears when a (re)loaded page connects', () => {
			connected.fire();
			assert.ok(!controller.visibleInboxes.has(rpc));
		});

		test('clears on dispose', () => {
			rpc.dispose();
			assert.ok(!controller.visibleInboxes.has(rpc));
		});
	});

	suite('access', () => {
		test('is unavailable while the feature flag is off', () => {
			controller.available = false;
			controller.changed.fire();
			assert.strictEqual(rpc.notificationsState.get().access, 'unavailable');
		});

		test('is signed out when the flag is on but there is no service', () => {
			controller.service = undefined;
			controller.changed.fire();
			assert.strictEqual(rpc.notificationsState.get().access, 'signedOut');
		});

		test('is signed in once there is a service', () => {
			controller.service = createService(() => Promise.resolve());
			controller.changed.fire();
			assert.strictEqual(rpc.notificationsState.get().access, 'signedIn');
		});

		test('carries the inbox id only while signed in, changing with the service', () => {
			controller.service = undefined;
			controller.inboxId = 1;
			controller.changed.fire();
			assert.strictEqual(rpc.notificationsState.get().inboxId, undefined);

			controller.service = createService(() => Promise.resolve());
			controller.changed.fire();
			assert.strictEqual(rpc.notificationsState.get().inboxId, 1);

			// e.g. an organization switch replaced the service
			controller.service = createService(() => Promise.resolve());
			controller.inboxId = 2;
			controller.changed.fire();
			assert.strictEqual(rpc.notificationsState.get().inboxId, 2);
		});
	});
});
