import { provideReactWrapper } from '@microsoft/fast-react-wrapper';
import React from 'react';
import { SearchNav as nativeComponent } from './search-nav';

export const SearchNav = provideReactWrapper(React).wrap(nativeComponent, {
	events: {
		onPrevious: 'previous',
		onNext: 'next',
	},
});
