import r2wc from '@r2wc/react-to-web-component';
import { GraphContainer } from '@gitkraken/gitkraken-components';

const GraphContainerWC = r2wc(GraphContainer);
customElements.define('graph-container', GraphContainerWC);
