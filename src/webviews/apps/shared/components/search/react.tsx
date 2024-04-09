import type { EventName } from '@lit/react';
import type { SearchQuery } from '../../../../../git/search';
import { reactWrapper } from '../helpers/react-wrapper';
import type { SearchNavigationEventDetail } from './search-box';
import { SearchBox as SearchBoxWC } from './search-box';

export interface SearchBox extends SearchBoxWC {}
export const SearchBox = reactWrapper(SearchBoxWC, {
	tagName: 'search-box',
	events: {
		onChange: 'change' as EventName<CustomEvent<SearchQuery>>,
		onNavigate: 'navigate' as EventName<CustomEvent<SearchNavigationEventDetail>>,
		onOpenInView: 'openinview',
	},
});
