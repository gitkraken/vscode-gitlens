import type { EventName } from '@lit/react';
import { reactWrapper } from '../helpers/react-wrapper';
import type { GlSearchBoxEvents } from './search-box';
import { GlSearchBox as GlSearchBoxWC } from './search-box';

export interface GlSearchBox extends GlSearchBoxWC {}
export const GlSearchBox = reactWrapper(GlSearchBoxWC, {
	tagName: 'gl-search-box',
	events: {
		onChange: 'gl-search-inputchange' as EventName<GlSearchBoxEvents['gl-search-inputchange']>,
		onNavigate: 'gl-search-navigate' as EventName<GlSearchBoxEvents['gl-search-navigate']>,
		onOpenInView: 'gl-search-openinview' as EventName<GlSearchBoxEvents['gl-search-openinview']>,
	},
});
