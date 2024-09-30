import GraphContainer from '@gitkraken/gitkraken-components';
import r2wc from '@r2wc/react-to-web-component';
import type { ComponentProps } from 'react';

type GraphContainerProps = ComponentProps<typeof GraphContainer>;

const GlGraphContainer = r2wc<GraphContainerProps>(GraphContainer);
customElements.define('gl-graph-container', GlGraphContainer);
