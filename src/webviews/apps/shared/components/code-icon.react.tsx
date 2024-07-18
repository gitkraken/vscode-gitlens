import { CodeIcon as CodeIconWC } from './code-icon';
import { reactWrapper } from './helpers/react-wrapper';

export interface CodeIcon extends CodeIconWC {}
export const CodeIcon = reactWrapper(CodeIconWC, { tagName: 'code-icon' });
