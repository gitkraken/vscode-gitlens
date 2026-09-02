import type { CommitGraphScrollMarkersControllerFactory } from '../contracts/scrollMarkers.js';
import type { CommitGraphScrollMarkersExtension } from '../profile.js';
import { ScrollMarkersController } from './scrollMarkers/controller.js';

const createController: CommitGraphScrollMarkersControllerFactory = (controllerHost, host) =>
	new ScrollMarkersController(controllerHost, host);

export const scrollMarkersExtension: CommitGraphScrollMarkersExtension = Object.freeze({
	createController: createController,
});
