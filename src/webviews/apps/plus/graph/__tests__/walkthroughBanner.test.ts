import * as assert from 'assert';
import { isGraphWalkthroughBannerHighlighted } from '../walkthroughBanner.js';

suite('graph walkthrough banner', () => {
	test('is not highlighted when there is no banner to highlight', () => {
		// Absent `collapsed` defaults to collapsed, so an unseeded state must not highlight
		assert.strictEqual(isGraphWalkthroughBannerHighlighted({}), false);
		assert.strictEqual(isGraphWalkthroughBannerHighlighted({ graphWalkthroughBannerCollapsed: true }), false);
		assert.strictEqual(
			isGraphWalkthroughBannerHighlighted({
				graphWalkthroughBannerCollapsed: true,
				graphWalkthroughStarted: false,
			}),
			false,
		);
	});

	test('is not highlighted once the walkthrough is complete', () => {
		assert.strictEqual(
			isGraphWalkthroughBannerHighlighted({
				graphWalkthroughBannerCollapsed: false,
				graphWalkthroughComplete: true,
			}),
			false,
		);
	});

	test('is highlighted only while expanded, incomplete, and unstarted', () => {
		assert.strictEqual(
			isGraphWalkthroughBannerHighlighted({ graphWalkthroughBannerCollapsed: false }),
			true,
			'absent complete/started default to not-complete and not-started',
		);
		assert.strictEqual(
			isGraphWalkthroughBannerHighlighted({
				graphWalkthroughBannerCollapsed: false,
				graphWalkthroughComplete: false,
				graphWalkthroughStarted: false,
			}),
			true,
		);
	});

	test('is not highlighted once the walkthrough has been started', () => {
		assert.strictEqual(
			isGraphWalkthroughBannerHighlighted({
				graphWalkthroughBannerCollapsed: false,
				graphWalkthroughComplete: false,
				graphWalkthroughStarted: true,
			}),
			false,
		);
	});
});
