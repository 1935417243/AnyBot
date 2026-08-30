// 代码块预览卡片：水合（注入 iframe/SVG/图表）与菜单交互
// 骨架由 markdown.js 的 markedRenderer.code 输出，本模块在消息渲染完成后接管

var MERMAID_SCRIPT_URL = 'vendor/mermaid/mermaid.min.js';
var mermaidLoader = null;
var mermaidSeq = 0;

// 首次遇到 mermaid 代码块时才加载 vendor 里的 mermaid.min.js
function loadMermaid() {
    if (window.mermaid) return Promise.resolve(window.mermaid);
    if (mermaidLoader) return mermaidLoader;
    mermaidLoader = new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = MERMAID_SCRIPT_URL;
        script.onload = function () {
            // 跟随当前明暗主题；strict 安全级别让 mermaid 内部用 DOMPurify 消毒标签文本
            var theme = document.documentElement.dataset.theme === 'light' ? 'default' : 'dark';
            window.mermaid.initialize({ startOnLoad: false, theme: theme, securityLevel: 'strict' });
            resolve(window.mermaid);
        };
        script.onerror = function () {
            mermaidLoader = null;
            reject(new Error('mermaid load failed'));
        };
        document.head.appendChild(script);
    });
    return mermaidLoader;
}

// 取卡片骨架里保存的原始代码文本
function getCardCode(card) {
    var codeEl = card.querySelector('.code-preview-source code');
    return codeEl ? (codeEl.textContent || '') : '';
}

// 渲染失败时在预览区给出提示，代码可通过菜单「查看代码」切换查看
function showPreviewError(card, message) {
    var stage = card.querySelector('.code-preview-stage');
    if (stage) {
        stage.innerHTML = '';
        var note = document.createElement('div');
        note.className = 'code-preview-error';
        note.textContent = message;
        stage.appendChild(note);
    }
}

function hydrateHtml(card, stage, code) {
    // 沙箱不含 allow-same-origin，预览页脚本无法触达宿主页面与同源接口
    var frame = document.createElement('iframe');
    frame.className = 'code-preview-frame';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('srcdoc', code);
    stage.innerHTML = '';
    stage.appendChild(frame);
}

function hydrateSvg(card, stage, code) {
    // img 中的 SVG 不执行脚本，天然隔离
    var img = document.createElement('img');
    img.className = 'code-preview-image';
    img.alt = card.querySelector('.code-preview-title').textContent || 'SVG 图像';
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(code)));
    img.onerror = function () { showPreviewError(card, 'SVG 渲染失败，可从菜单查看代码'); };
    stage.innerHTML = '';
    stage.appendChild(img);
}

function hydrateMermaid(card, stage, code) {
    loadMermaid().then(function (mermaid) {
        if (!card.isConnected) return;
        mermaidSeq += 1;
        return mermaid.render('code-preview-mermaid-' + mermaidSeq, code).then(function (result) {
            stage.innerHTML = result.svg;
        });
    }).catch(function () {
        if (!card.isConnected) return;
        showPreviewError(card, 'Mermaid 渲染失败，可从菜单查看代码');
    });
}

function hydrateCard(card) {
    card.dataset.hydrated = '1';
    var lang = card.dataset.codeLang;
    var stage = card.querySelector('.code-preview-stage');
    if (!stage) return;
    var code = getCardCode(card);
    if (lang === 'html') hydrateHtml(card, stage, code);
    else if (lang === 'svg') hydrateSvg(card, stage, code);
    else if (lang === 'mermaid') hydrateMermaid(card, stage, code);
}

// 消息渲染完成后调用：把 root 内未水合的预览卡片升级为真实预览
export function enhanceCodeBlocks(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    root.querySelectorAll('.code-preview-card:not([data-hydrated])').forEach(hydrateCard);
}

function closeAllMenus(exceptCard) {
    document.querySelectorAll('.code-preview-card.menu-open').forEach(function (card) {
        if (card !== exceptCard) {
            card.classList.remove('menu-open');
            var btn = card.querySelector('.code-preview-menu-btn');
            if (btn) btn.setAttribute('aria-expanded', 'false');
        }
    });
}

// 同步「查看代码/查看预览」菜单项文案
function syncToggleOption(card) {
    var option = card.querySelector('.code-preview-option[data-action="toggle-view"]');
    if (option) option.textContent = card.classList.contains('show-code') ? '查看预览' : '查看代码';
}

function copyCardCode(card, option) {
    navigator.clipboard.writeText(getCardCode(card)).then(function () {
        option.textContent = '已复制';
        setTimeout(function () { option.textContent = '复制代码'; }, 1500);
    });
}

function downloadBlob(content, type, filename) {
    var blob = new Blob([content], { type: type });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

// html 下载源码（即产物）；svg/mermaid 优先下载渲染产物，未渲染成功时回退源码
function downloadCard(card) {
    var lang = card.dataset.codeLang;
    var code = getCardCode(card);
    if (lang === 'html') {
        downloadBlob(code, 'text/html;charset=utf-8', 'preview.html');
        return;
    }
    var stageSvg = card.querySelector('.code-preview-stage svg');
    if (lang === 'mermaid') {
        if (stageSvg) downloadBlob(stageSvg.outerHTML, 'image/svg+xml;charset=utf-8', 'diagram.svg');
        else downloadBlob(code, 'text/plain;charset=utf-8', 'diagram.mmd');
        return;
    }
    downloadBlob(code, 'image/svg+xml;charset=utf-8', 'image.svg');
}

function handleMenuAction(card, action, option) {
    if (action === 'toggle-view') {
        card.classList.toggle('show-code');
        syncToggleOption(card);
    } else if (action === 'copy') {
        copyCardCode(card, option);
    } else if (action === 'download') {
        downloadCard(card);
    }
}

// 消息列表的点击委托入口：命中卡片内交互返回 true，由调用方阻止后续处理
export function handleCodePreviewClick(target) {
    if (!target || typeof target.closest !== 'function') return false;

    var toggle = target.closest('.code-preview-toggle');
    if (toggle) {
        var toggleCard = toggle.closest('.code-preview-card');
        var collapsed = toggleCard.classList.toggle('collapsed');
        toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        return true;
    }

    var menuBtn = target.closest('.code-preview-menu-btn');
    if (menuBtn) {
        var menuCard = menuBtn.closest('.code-preview-card');
        var opening = !menuCard.classList.contains('menu-open');
        closeAllMenus(menuCard);
        menuCard.classList.toggle('menu-open', opening);
        menuBtn.setAttribute('aria-expanded', opening ? 'true' : 'false');
        if (opening) syncToggleOption(menuCard);
        return true;
    }

    var option = target.closest('.code-preview-option');
    if (option) {
        var optionCard = option.closest('.code-preview-card');
        handleMenuAction(optionCard, option.dataset.action, option);
        optionCard.classList.remove('menu-open');
        var btn = optionCard.querySelector('.code-preview-menu-btn');
        if (btn) btn.setAttribute('aria-expanded', 'false');
        return true;
    }

    return false;
}

// 点击卡片外部时关闭已打开的菜单（模块级只注册一次）
document.addEventListener('click', function (e) {
    document.querySelectorAll('.code-preview-card.menu-open').forEach(function (card) {
        if (!card.contains(e.target)) {
            card.classList.remove('menu-open');
            var btn = card.querySelector('.code-preview-menu-btn');
            if (btn) btn.setAttribute('aria-expanded', 'false');
        }
    });
});
