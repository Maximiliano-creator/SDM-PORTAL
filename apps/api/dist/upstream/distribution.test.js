import { describe, expect, it } from 'vitest';
import { normalizeDistributionTypes } from './distribution.js';
describe('normalizeDistributionTypes', () => {
    it('includes grouping whenever product PLUs are sent', () => {
        expect(normalizeDistributionTypes([0])).toEqual([0, 1]);
    });
    it('deduplicates and sorts all requested packages', () => {
        expect(normalizeDistributionTypes([2, 0, 1, 0])).toEqual([0, 1, 2]);
    });
    it('does not add product or grouping packages when only images are sent', () => {
        expect(normalizeDistributionTypes([2])).toEqual([2]);
    });
});
//# sourceMappingURL=distribution.test.js.map