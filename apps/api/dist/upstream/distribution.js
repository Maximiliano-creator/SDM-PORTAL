// term_admin sends product PLUs and their group associations as separate packages.
export function normalizeDistributionTypes(typeList) {
    const types = new Set(typeList);
    if (types.has(0))
        types.add(1);
    return [...types].sort((a, b) => a - b);
}
//# sourceMappingURL=distribution.js.map