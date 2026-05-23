const DEFAULT_CACHE_TTL_MS = 5 * 1000;

export function createSlashItemsStore(options) {
    options = options || {};
    var slashItemsData = null;
    var slashItemsDataProvider = '';
    var slashItemsDataCache = {};
    var cacheTtlMs = Number(options.cacheTtlMs || DEFAULT_CACHE_TTL_MS);

    function getActiveProviderType() {
        var providerData = options.getProviderData ? options.getProviderData() : null;
        var modelConfig = options.getModelConfig ? options.getModelConfig() : null;
        var currentProvider = options.getCurrentSessionProvider ? options.getCurrentSessionProvider() : null;
        return currentProvider || (providerData && providerData.current) || (modelConfig && modelConfig.provider) || '';
    }

    function getProviderQuery(providerType) {
        return providerType ? '?provider=' + encodeURIComponent(providerType) : '';
    }

    function getCacheKey(providerType) {
        return providerType || '__current__';
    }

    function getState() {
        var providerType = getActiveProviderType();
        return slashItemsDataProvider === providerType ? slashItemsData : null;
    }

    function invalidate(providerType) {
        if (providerType) {
            delete slashItemsDataCache[getCacheKey(providerType)];
            if (slashItemsDataProvider !== providerType) return;
        } else {
            slashItemsDataCache = {};
        }
        slashItemsData = null;
        slashItemsDataProvider = '';
    }

    async function fetchItems(force) {
        var providerType = getActiveProviderType();
        var cacheKey = getCacheKey(providerType);
        var cached = slashItemsDataCache[cacheKey];
        if (!force && cached && Date.now() - cached.fetchedAt < cacheTtlMs) {
            slashItemsData = cached.data;
            slashItemsDataProvider = providerType;
            return;
        }
        try {
            var res = await fetch('/api/slash/items' + getProviderQuery(providerType));
            slashItemsData = await res.json();
            slashItemsDataProvider = providerType;
            var fetchedAt = Date.now();
            slashItemsDataCache[cacheKey] = {
                data: slashItemsData,
                fetchedAt: fetchedAt,
            };
        } catch (e) {
            console.error('Failed to fetch slash items:', e);
            slashItemsData = { groups: [] };
            slashItemsDataProvider = providerType;
        }
    }

    return {
        fetchItems: fetchItems,
        getActiveProviderType: getActiveProviderType,
        getProviderQuery: getProviderQuery,
        getState: getState,
        invalidate: invalidate,
    };
}
