import { provideReactWrapper } from '@microsoft/fast-react-wrapper';
import React from 'react';
import { SearchBox as searchBoxComponent } from './search-box';

const { wrap } = provideReactWrapper(React);

export const SearchBox = wrap(searchBoxComponent, {
	events: {
		onChange: 'change',
		onPrevious: 'previous',
		onNext: 'next',
		onOpenInView: 'openinview',
	},
});
