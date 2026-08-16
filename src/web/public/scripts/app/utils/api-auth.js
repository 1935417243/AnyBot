// API 鉴权引导:token 由后端在 index.html 中注入(window.__ANYBOT_API_TOKEN__)。
// 这里统一包装 fetch,为同源 /api 请求自动附带 Authorization: Bearer;
// EventSource、<img src>、整页跳转等无法自定义 header 的场景使用 window.withApiToken()
// 拼 ?token= 查询参数。本文件必须作为普通 script 最先加载(在所有业务脚本之前)。
(function () {
    var token = window.__ANYBOT_API_TOKEN__ || '';

    window.withApiToken = function (url) {
        if (!token) return url;
        return url + (url.indexOf('?') === -1 ? '?' : '&') + 'token=' + encodeURIComponent(token);
    };

    if (!token || typeof window.fetch !== 'function') return;

    var originalFetch = window.fetch.bind(window);

    function isApiUrl(url) {
        return url === '/api'
            || url.indexOf('/api/') === 0
            || url.indexOf(window.location.origin + '/api/') === 0
            || url === window.location.origin + '/api';
    }

    window.fetch = function (input, init) {
        try {
            var url = typeof input === 'string' ? input : (input && input.url) || '';
            if (isApiUrl(url)) {
                var headers = new Headers(
                    (init && init.headers)
                    || (input && typeof input === 'object' && input.headers)
                    || undefined
                );
                if (!headers.has('Authorization')) {
                    headers.set('Authorization', 'Bearer ' + token);
                }
                if (input && typeof input === 'object' && input.url) {
                    input = new Request(input, { headers: headers });
                } else {
                    init = Object.assign({}, init, { headers: headers });
                }
            }
        } catch (e) {
            // 包装失败时按原始参数发起,不影响正常请求。
        }
        return originalFetch(input, init);
    };
})();
