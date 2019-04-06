'use strict';
/*global window*/
import { WelcomeBootstrap } from '../../protocol';
// import { Snow } from './snow';
import { AppWithConfig } from '../shared/appWithConfigBase';

const bootstrap: WelcomeBootstrap = (window as any).bootstrap;

export class WelcomeApp extends AppWithConfig<WelcomeBootstrap> {
    constructor() {
        super('WelcomeApp', bootstrap);
    }
}

new WelcomeApp();
// requestAnimationFrame(() => new Snow());
