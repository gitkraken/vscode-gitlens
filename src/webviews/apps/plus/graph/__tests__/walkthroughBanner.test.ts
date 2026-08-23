import * as assert from 'assert';
import type { GraphWalkthroughContextKeys, GraphWalkthroughProgress } from '../../../../../constants.walkthroughs.js';
import { isGraphWalkthroughBannerHighlighted } from '../walkthroughBanner.js';

const emptyGraphWalkthroughState: Record<GraphWalkthroughContextKeys, boolean> = {
	graphAgentMonitoring: false,
	graphParallelWork: false,
	graphAiReview: false,
	graphCompose: false,
	graphCompare: false,
	graphNextSteps: false,
};

/** Only `doneCount`/`allCount` are read by `isGraphWalkthroughBannerHighlighted`. */
function progress(doneCount: number, allCount: number): GraphWalkthroughProgress {
	return {
		doneCount: doneCount,
		allCount: allCount,
		progress: doneCount / allCount,
		state: emptyGraphWalkthroughState,
	};
}

suite('graph walkthrough banner', () => {
	test('is not highlighted when there is no banner to highlight', () => {
		// Absent `bannerCollapsed` defaults to collapsed, so an unseeded state must not highlight
		assert.strictEqual(
			isGraphWalkthroughBannerHighlighted({ bannerCollapsed: undefined, graphWalkthroughProgress: undefined }),
			false,
		);
		assert.strictEqual(
			isGraphWalkthroughBannerHighlighted({ bannerCollapsed: true, graphWalkthroughProgress: undefined }),
			false,
		);
		assert.strictEqual(
			isGraphWalkthroughBannerHighlighted({
				bannerCollapsed: true,
				graphWalkthroughProgress: undefined,
				graphWalkthroughStarted: false,
			}),
			false,
		);
	});

	test('is not highlighted once the walkthrough is complete', () => {
		assert.strictEqual(
			isGraphWalkthroughBannerHighlighted({
				bannerCollapsed: false,
				graphWalkthroughProgress: progress(6, 6),
			}),
			false,
		);
	});

	test('is highlighted only while expanded, incomplete, and unstarted', () => {
		assert.strictEqual(
			isGraphWalkthroughBannerHighlighted({ bannerCollapsed: false, graphWalkthroughProgress: undefined }),
			true,
			'absent progress/started default to not-complete and not-started',
		);
		assert.strictEqual(
			isGraphWalkthroughBannerHighlighted({
				bannerCollapsed: false,
				graphWalkthroughProgress: progress(0, 6),
				graphWalkthroughStarted: false,
			}),
			true,
		);
	});

	test('is not highlighted once the walkthrough has been started', () => {
		assert.strictEqual(
			isGraphWalkthroughBannerHighlighted({
				bannerCollapsed: false,
				graphWalkthroughProgress: progress(0, 6),
				graphWalkthroughStarted: true,
			}),
			false,
		);
	});
});
