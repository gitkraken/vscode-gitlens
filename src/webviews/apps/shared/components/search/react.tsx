import { reactWrapper } from '../helpers/react-wrapper';
import { SearchBox as searchBoxComponent } from './search-box';

export const SearchBox = reactWrapper(searchBoxComponent, {
	events: {
		onChange: 'change',
		onNavigate: 'navigate',
		onOpenInView: 'openinview',
	},
});
