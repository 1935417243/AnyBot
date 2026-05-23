export function formatTokenCount(value) {
    var n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1).replace(/\.0$/, '') + 'm';
    if (n >= 1000) return Math.round(n / 1000) + 'k';
    return String(Math.round(n));
}

export function createContextUsageController(options) {
    options = options || {};
    var contextUsageEl = options.contextUsageEl || document.getElementById('context-usage');
    var contextUsageRingEl = options.contextUsageRingEl || document.getElementById('context-usage-ring');
    var contextUsagePercentEl = options.contextUsagePercentEl || document.getElementById('context-usage-percent');
    var contextUsageTokensEl = options.contextUsageTokensEl || document.getElementById('context-usage-tokens');
    var contextUsageProviderEl = options.contextUsageProviderEl || document.getElementById('context-usage-provider');
    var latestContextUsage = null;

    function contextUsageColor(percent) {
        if (percent >= 90) return '#ef4444';
        if (percent >= 70) return '#f59e0b';
        return '#9ca3af';
    }

    function normalizeUsage(usage) {
        return usage || {
            usedTokens: 0,
            maxTokens: 0,
            usedPercentage: 0,
            remainingPercentage: 100,
            source: '',
        };
    }

    function updateUsage(usage) {
        latestContextUsage = normalizeUsage(usage);
        if (!contextUsageEl || !contextUsageRingEl || !latestContextUsage) return;

        var usedPercent = Math.max(0, Math.min(100, Number(latestContextUsage.usedPercentage || 0)));
        var remainingPercent = Math.max(0, Math.round((100 - usedPercent) * 10) / 10);
        var usedTokens = Number(latestContextUsage.usedTokens || 0);
        var maxTokens = Number(latestContextUsage.maxTokens || 0);
        var color = contextUsageColor(usedPercent);
        var degrees = usedPercent * 3.6;

        contextUsageEl.classList.toggle('has-data', usedTokens > 0 && maxTokens > 0);
        contextUsageRingEl.style.background =
            'radial-gradient(circle at center, var(--input-bg) 48%, transparent 50%), ' +
            'conic-gradient(' + color + ' ' + degrees + 'deg, var(--ring-track) ' + degrees + 'deg)';

        if (contextUsagePercentEl) {
            contextUsagePercentEl.textContent =
                Math.round(usedPercent) + '% 已用（剩余 ' + Math.round(remainingPercent) + '%）';
        }
        if (contextUsageTokensEl) {
            contextUsageTokensEl.textContent =
                '已用 ' + formatTokenCount(usedTokens) + ' token，共 ' + formatTokenCount(maxTokens);
        }
        if (contextUsageProviderEl) {
            contextUsageProviderEl.textContent = '';
        }
    }

    return {
        getLatestUsage: function () {
            return latestContextUsage;
        },
        updateUsage: updateUsage,
    };
}
