import type { EventName } from '@lit/react';
import type { CustomEventType } from '../element';
import { reactWrapper } from '../helpers/react-wrapper';
import { GlSearchBox as GlSearchBoxWC } from './search-box';

export interface GlSearchBox extends GlSearchBoxWC {}
export const GlSearchBox = reactWrapper(GlSearchBoxWC, {
	tagName: 'gl-search-box',
	events: {
		onChange: 'gl-search-inputchange' as EventName<CustomEventType<'gl-search-inputchange'>>,
		onNavigate: 'gl-search-navigate' as EventName<CustomEventType<'gl-search-navigate'>>,
		onOpenInView: 'gl-search-openinview' as EventName<CustomEventType<'gl-search-openinview'>>,
		onSearchModeChange: 'gl-search-modechange' as EventName<CustomEventType<'gl-search-modechange'>>,
	},
});
