import * as assert from 'assert';
import * as sinon from 'sinon';
import type { StoredFeaturePreviewUsagePeriod } from '../constants.storage.js';
import { proFeaturePreviewUsageDurationInDays } from '../constants.subscription.js';
import type { FeaturePreview } from '../features.js';
import { getFeaturePreviewExpiry, getFeaturePreviewStatus } from '../features.js';

const minute = 60 * 1000;
const hour = 60 * minute;
const now = new Date('2026-10-13T12:00:00.000Z').getTime();

/** A window that started `startedAgo` before `now` and was stored with the given length */
function usage(startedAgo: number, length: number): StoredFeaturePreviewUsagePeriod {
	const startedOn = now - startedAgo;
	return { startedOn: new Date(startedOn).toISOString(), expiresOn: new Date(startedOn + length).toISOString() };
}

function preview(...usages: StoredFeaturePreviewUsagePeriod[]): FeaturePreview {
	return { feature: 'graph', usages: usages };
}

suite('Feature preview window', () => {
	let clock: sinon.SinonFakeTimers;

	setup(() => {
		clock = sinon.useFakeTimers({ now: now, toFake: ['Date'] });
	});

	teardown(() => {
		clock.restore();
	});

	test('is eligible with no recorded usage', () => {
		assert.strictEqual(getFeaturePreviewStatus(preview()), 'eligible');
		assert.strictEqual(getFeaturePreviewExpiry(preview()), undefined);
	});

	test('is active through the 72 hours after its start', () => {
		assert.strictEqual(getFeaturePreviewStatus(preview(usage(hour, 72 * hour))), 'active');
		assert.strictEqual(getFeaturePreviewStatus(preview(usage(72 * hour - minute, 72 * hour))), 'active');
	});

	test('expires exactly 72 hours after its start', () => {
		assert.strictEqual(getFeaturePreviewStatus(preview(usage(72 * hour, 72 * hour))), 'expired');
		assert.strictEqual(getFeaturePreviewStatus(preview(usage(30 * 24 * hour, 72 * hour))), 'expired');
	});

	test('expires rather than extends when the clock is rolled back before its start', () => {
		assert.strictEqual(getFeaturePreviewStatus(preview(usage(-hour, 72 * hour))), 'expired');
	});

	test('anchors the expiry on the start, not the stored expiresOn', () => {
		const p = preview(usage(80 * hour, 100 * hour));

		assert.strictEqual(getFeaturePreviewExpiry(p)?.getTime(), now - 80 * hour + 72 * hour);
		assert.strictEqual(getFeaturePreviewStatus(p), 'expired');
	});

	test('reads a legacy one-day record as eligible, with no expiry', () => {
		const recent = preview(usage(hour, 24 * hour));
		assert.strictEqual(getFeaturePreviewStatus(recent), 'eligible');
		assert.strictEqual(getFeaturePreviewExpiry(recent), undefined);

		const continued = preview(usage(30 * 24 * hour, 24 * hour), usage(20 * 24 * hour, 24 * hour));
		assert.strictEqual(getFeaturePreviewStatus(continued), 'eligible');
	});

	test('treats windows shorter than two days as legacy', () => {
		assert.strictEqual(getFeaturePreviewStatus(preview(usage(hour, 48 * hour - minute))), 'eligible');
		assert.strictEqual(getFeaturePreviewStatus(preview(usage(hour, 48 * hour))), 'active');
	});

	test('never reads a freshly started window as legacy', () => {
		// The legacy cutoff describes the old one-day records, not the current duration — shortening the
		// preview below two days would make every new window read as legacy, renewing it forever
		const fresh = preview(usage(0, proFeaturePreviewUsageDurationInDays * 24 * hour));

		assert.strictEqual(getFeaturePreviewStatus(fresh), 'active');
		assert.notStrictEqual(getFeaturePreviewExpiry(fresh), undefined);
	});
});
