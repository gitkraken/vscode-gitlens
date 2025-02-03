import type { GraphRefOptData } from '@gitkraken/gitkraken-components';
import React from 'react';
import { CodeIcon } from '../../../shared/components/code-icon.react';

// eslint-disable-next-line @typescript-eslint/naming-convention
export function RemoteIcon({ refOptData }: Readonly<{ refOptData: GraphRefOptData }>) {
	if (refOptData.avatarUrl) {
		return <img alt={refOptData.name} style={{ width: 14, aspectRatio: 1 }} src={refOptData.avatarUrl} />;
	}
	let icon = '';
	switch (refOptData.type) {
		case 'head':
			icon = 'vm';
			break;
		case 'remote':
			icon = 'cloud';
			break;
		case 'tag':
			icon = 'tag';
			break;
		default:
			break;
	}
	return <CodeIcon size={14} icon={icon} />;
}
