import type { CommitGraphScrollMarkersControllerFactory } from '../contracts/scrollMarkers.js';
import { ScrollMarkersController } from '../graphScrollMarkers.js';
import type { CommitGraphScrollMarkersExtension } from '../runtime.js';

const createController: CommitGraphScrollMarkersControllerFactory = (controllerHost, host) =>
	new ScrollMarkersController(controllerHost, host);

export const scrollMarkersExtension: CommitGraphScrollMarkersExtension = Object.freeze({
	id: 'scroll-markers',
	createController: createController,
});
