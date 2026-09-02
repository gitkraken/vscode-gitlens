import type { CommitGraphStickyTimelineControllerFactory } from '../contracts/stickyTimeline.js';
import type { CommitGraphStickyTimelineExtension } from '../profile.js';
import { StickyTimelineController, stickyTimelineGroupKeyFor } from './stickyTimeline/controller.js';

const createController: CommitGraphStickyTimelineControllerFactory = (controllerHost, host) =>
	new StickyTimelineController(controllerHost, host);

export const stickyTimelineExtension: CommitGraphStickyTimelineExtension = Object.freeze({
	createController: createController,
	groupKey: stickyTimelineGroupKeyFor,
});
