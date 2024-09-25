import { reactWrapper } from '../helpers/react-wrapper';
import { GlMarkdown as GlMarkdownWC } from './markdown';

export interface GlMarkdown extends GlMarkdownWC {}
export const GlMarkdown = reactWrapper(GlMarkdownWC, { tagName: 'gl-markdown' });
