import { provideReactWrapper } from '@microsoft/fast-react-wrapper';
import React from 'react';
import { SearchField as fieldComponent } from './search-field';
import { SearchNav as navComponent } from './search-nav';

const { wrap } = provideReactWrapper(React);

export const SearchField = wrap(fieldComponent, {
	events: {
		onChange: 'change',
		onPrevious: 'previous',
		onNext: 'next',
	},
});

export const SearchNav = wrap(navComponent, {
	events: {
		onPrevious: 'previous',
		onNext: 'next',
	},
});
