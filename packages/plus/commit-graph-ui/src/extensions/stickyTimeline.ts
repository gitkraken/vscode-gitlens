import type { CommitGraphStickyTimelineControllerFactory } from '../contracts/stickyTimeline.js';
import { StickyTimelineController, stickyTimelineGroupKeyFor } from '../graphStickyTimeline.js';
import type { CommitGraphStickyTimelineExtension } from '../runtime.js';

const createController: CommitGraphStickyTimelineControllerFactory = (controllerHost, host) =>
	new StickyTimelineController(controllerHost, host);

export const stickyTimelineExtension: CommitGraphStickyTimelineExtension = Object.freeze({
	id: 'sticky-timeline',
	createController: createController,
	groupKey: stickyTimelineGroupKeyFor,
});
