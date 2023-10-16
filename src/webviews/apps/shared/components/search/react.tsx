import type { EventName } from '@lit/react';
import type { SearchQuery } from '../../../../../git/search';
import { reactWrapper } from '../helpers/react-wrapper';
import type { SearchNavigationEventDetail } from './search-box';
import { SearchBox as searchBoxComponent } from './search-box';

export const SearchBox = reactWrapper(searchBoxComponent, {
	tagName: 'search-box',
	events: {
		onChange: 'change' as EventName<CustomEvent<SearchQuery>>,
		onNavigate: 'navigate' as EventName<CustomEvent<SearchNavigationEventDetail>>,
		onOpenInView: 'openinview',
	},
});
