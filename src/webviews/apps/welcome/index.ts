'use strict';
/*global window*/
import { WelcomeState } from '../../protocol';
// import { Snow } from './snow';
import { AppWithConfig } from '../shared/appWithConfigBase';

export class WelcomeApp extends AppWithConfig<WelcomeState> {
	constructor() {
		super('WelcomeApp', (window as any).bootstrap);
		(window as any).bootstrap = undefined;
	}
}

new WelcomeApp();
// requestAnimationFrame(() => new Snow());
