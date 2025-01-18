import { reactWrapper } from '../../../shared/components/helpers/react-wrapper';
import { GlMergeConflictWarning as GlMergeConflictWarningWC } from './merge-rebase-status';

export interface GlMergeConflictWarning extends GlMergeConflictWarningWC {}
export const GlMergeConflictWarning = reactWrapper(GlMergeConflictWarningWC, { tagName: 'gl-merge-rebase-status' });
