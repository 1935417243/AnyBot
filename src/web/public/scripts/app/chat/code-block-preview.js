// 代码块预览卡片：水合（注入 iframe/SVG/图表）与菜单交互
// 骨架由 markdown.js 的 markedRenderer.code 输出，本模块在消息渲染完成后接管

var MERMAID_SCRIPT_URL = 'vendor/mermaid/mermaid.min.js';
var mermaidLoader = null;
var mermaidSeq = 0;

// mermaid 串行渲染队列：render 是 CPU 密集操作，逐个执行摊平主线程尖峰
var mermaidChain = Promise.resolve();

function enqueueMermaidRender(task) {
    mermaidChain = mermaidChain.then(function () {
        return task();
    }).catch(function () {
        // task 内部已自行兜底，这里只保证队列不被单个失败中断
    });
}

// 卡片进视口才真正水合（提前 200px 预渲染），未见的卡片保持「渲染中…」占位零成本
var lazyObserver = (typeof IntersectionObserver !== 'undefined')
    ? new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            var card = entry.target;
            lazyObserver.unobserve(card);
            hydrateCard(card);
        });
    }, { rootMargin: '200px 0px' })
    : null;

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

// iframe 高度上报消息前缀：srcdoc 内注入的探针脚本通过 postMessage 汇报内容高度
var FRAME_HEIGHT_PREFIX = 'anybot-code-preview-height:';

// 沙箱 iframe 无同源权限，父页面读不到内容尺寸，注入探针脚本让其主动适配并上报
// 内容比 iframe 宽时等比 zoom 缩小（不低于 0.4，再小保留横向滚动），
// 内容比 iframe 窄时等比放大填满（不超过 2，响应式页面自身铺满时 scale=1 不受影响）
function buildAutoHeightSrcdoc(code) {
    var probe = '<script>(function(){'
        + 'var lastH=0;'
        + 'function fit(){'
        + 'var de=document.documentElement,b=document.body;'
        + 'if(!de)return;'
        + 'var vw=de.clientWidth;'
        + 'var cw=Math.max(b?b.scrollWidth:0,de.scrollWidth);'
        + 'if(b){'
        + 'var scale=(vw>0&&cw>0)?vw/cw:1;'
        + 'scale=Math.min(Math.max(scale,0.4),2);'
        + 'b.style.zoom=Math.abs(scale-1)>0.01?scale:1;'
        + '}'
        + 'var h=Math.max(b?b.scrollHeight:0,de.scrollHeight);'
        + 'h=Math.ceil(h);'
        + 'if(h>0&&h!==lastH){lastH=h;parent.postMessage(' + JSON.stringify(FRAME_HEIGHT_PREFIX) + '+h,"*");}'
        + '}'
        + 'window.addEventListener("load",fit);'
        + 'window.addEventListener("resize",fit);'
        + 'if(typeof ResizeObserver!=="undefined"&&document.documentElement){new ResizeObserver(fit).observe(document.documentElement);}'
        + 'fit();'
        + '})();</scr' + 'ipt>';
    if (/<\/body\s*>/i.test(code)) return code.replace(/<\/body\s*>/i, probe + '</body>');
    return code + probe;
}

// 校验来源是某个预览 iframe 后按上报值调整高度，夹在 120px ~ 70% 视口高之间
window.addEventListener('message', function (e) {
    if (typeof e.data !== 'string' || e.data.indexOf(FRAME_HEIGHT_PREFIX) !== 0) return;
    var reported = parseInt(e.data.slice(FRAME_HEIGHT_PREFIX.length), 10);
    if (!isFinite(reported) || reported <= 0) return;
    var maxHeight = Math.max(200, Math.round(window.innerHeight * 0.7));
    var height = Math.min(Math.max(reported, 120), maxHeight);
    document.querySelectorAll('.code-preview-frame').forEach(function (frame) {
        if (frame.contentWindow === e.source) frame.style.height = height + 'px';
    });
});

function hydrateHtml(card, stage, code) {
    // 沙箱不含 allow-same-origin，预览页脚本无法触达宿主页面与同源接口
    var frame = document.createElement('iframe');
    frame.className = 'code-preview-frame';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('srcdoc', buildAutoHeightSrcdoc(code));
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
    enqueueMermaidRender(function () {
        if (!card.isConnected) return null;
        return loadMermaid().then(function (mermaid) {
            if (!card.isConnected) return null;
            mermaidSeq += 1;
            return mermaid.render('code-preview-mermaid-' + mermaidSeq, code).then(function (result) {
                stage.innerHTML = result.svg;
            });
        }).catch(function () {
            if (!card.isConnected) return;
            showPreviewError(card, 'Mermaid 渲染失败，可从菜单查看代码');
        });
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

// 消息渲染完成后调用：登记 root 内的预览卡片，滚进视口才水合
// 已渲染过的卡片带 data-hydrated 标记，任何重复调用都会跳过
export function enhanceCodeBlocks(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    root.querySelectorAll('.code-preview-card:not([data-hydrated]):not([data-observed])').forEach(function (card) {
        if (!lazyObserver) {
            hydrateCard(card);
            return;
        }
        card.dataset.observed = '1';
        lazyObserver.observe(card);
    });
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

// html 下载源码（即产物）；svg 优先下载渲染产物，未渲染成功时回退源码
// mermaid 不提供下载（菜单已隐藏），统一走「保存为图片」导出 PNG
function downloadCard(card) {
    var lang = card.dataset.codeLang;
    var code = getCardCode(card);
    if (lang === 'html') {
        downloadBlob(code, 'text/html;charset=utf-8', buildHtmlFileBase(card) + '.html');
        return;
    }
    downloadBlob(code, 'image/svg+xml;charset=utf-8', 'image.svg');
}

// 保存为图片的调试日志，导出卡住时用于定位停在哪一步
function saveImageLog() {
    var args = ['[code-preview][save-image]'];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    console.log.apply(console, args);
}

function closeCardMenu(card) {
    card.classList.remove('menu-open');
    var btn = card.querySelector('.code-preview-menu-btn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
}

// 标签文字按可用宽度换行：英文按词分（空格处断行），中文逐字可断，超长单词硬切
function wrapLabelText(text, maxChars) {
    var tokens = [];
    text.split(/(\s+)/).forEach(function (part) {
        if (!part) return;
        if (/^\s+$/.test(part)) {
            tokens.push(' ');
            return;
        }
        if (/[\u4e00-\u9fff\uff00-\uffef]/.test(part)) {
            part.split('').forEach(function (ch) { tokens.push(ch); });
        } else if (part.length > maxChars) {
            for (var i = 0; i < part.length; i += maxChars) tokens.push(part.slice(i, i + maxChars));
        } else {
            tokens.push(part);
        }
    });
    var lines = [];
    var current = '';
    tokens.forEach(function (token) {
        if (current && (current + token).length > maxChars) {
            lines.push(current.replace(/\s+$/, ''));
            current = token.replace(/^\s+/, '');
        } else {
            current += token;
        }
    });
    if (current.trim()) lines.push(current.replace(/\s+$/, ''));
    return lines;
}

// 含 foreignObject 的 SVG 画进 canvas 会被标记为 tainted 禁止导出（浏览器安全规范），
// 导出前把其中的 HTML 标签原地替换为原生 <text>：继承父级 g 的定位变换，
// 所以坐标直接用 foreignObject 本地坐标系的中心，颜色、字号从页面已渲染的图表量取
function convertForeignObjectsToText(liveSvg, cloneSvg) {
    var SVG_NS = 'http://www.w3.org/2000/svg';
    var liveFos = liveSvg.querySelectorAll('foreignObject');
    var cloneFos = cloneSvg.querySelectorAll('foreignObject');
    liveFos.forEach(function (liveFo, i) {
        var target = cloneFos[i];
        if (!target || !target.parentNode) return;
        var text = (liveFo.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text) {
            target.parentNode.removeChild(target);
            return;
        }
        var localW = parseFloat(liveFo.getAttribute('width')) || 0;
        var localH = parseFloat(liveFo.getAttribute('height')) || 0;
        var styleSource = liveFo.querySelector('span, p, div') || liveFo;
        var cs = getComputedStyle(styleSource);
        var fontSize = parseFloat(cs.fontSize) || 14;

        var textEl = document.createElementNS(SVG_NS, 'text');
        textEl.setAttribute('text-anchor', 'middle');
        textEl.setAttribute('fill', cs.color || '#000000');
        textEl.setAttribute('font-size', fontSize + 'px');
        textEl.setAttribute('font-family', cs.fontFamily || 'sans-serif');

        // 按 foreignObject 可用宽度换行，垂直居中排列
        var maxChars = Math.max(4, Math.floor(localW / (fontSize * 0.62)));
        var lines = wrapLabelText(text, maxChars);
        var lineHeight = fontSize * 1.35;
        var startY = localH / 2 - ((lines.length - 1) * lineHeight) / 2 + fontSize * 0.35;
        lines.forEach(function (line, idx) {
            var tspan = document.createElementNS(SVG_NS, 'tspan');
            tspan.setAttribute('x', localW / 2);
            tspan.setAttribute('y', startY + idx * lineHeight);
            tspan.textContent = line;
            textEl.appendChild(tspan);
        });
        target.parentNode.replaceChild(textEl, target);
    });
}

// mermaid 首行关键字到图表类型中文名的映射，用于导出文件命名
var MERMAID_TYPE_NAMES = [
    [/^(graph|flowchart)\b/, '流程图'],
    [/^sequencediagram\b/i, '时序图'],
    [/^classdiagram\b/i, '类图'],
    [/^statediagram/i, '状态图'],
    [/^erdiagram\b/i, 'ER图'],
    [/^gantt\b/i, '甘特图'],
    [/^journey\b/i, '用户旅程图'],
    [/^pie\b/i, '饼图'],
    [/^gitgraph\b/i, 'Git图'],
    [/^mindmap\b/i, '思维导图'],
    [/^timeline\b/i, '时间线图'],
    [/^quadrantchart\b/i, '象限图'],
];

// 生成时分秒后缀（如 104230），区分同一内容的多次导出
function buildExportTimestamp() {
    var now = new Date();
    return String(now.getHours()).padStart(2, '0')
        + String(now.getMinutes()).padStart(2, '0')
        + String(now.getSeconds()).padStart(2, '0');
}

// 生成带业务辨识度的导出文件名主体：图表类型 + 首个节点标签摘要 + 时分秒，兜底 diagram
function buildMermaidFileBase(card) {
    var code = getCardCode(card);
    var firstLine = code.trim().split('\n')[0].trim();
    var typeName = '图表';
    for (var i = 0; i < MERMAID_TYPE_NAMES.length; i++) {
        if (MERMAID_TYPE_NAMES[i][0].test(firstLine)) {
            typeName = MERMAID_TYPE_NAMES[i][1];
            break;
        }
    }
    // 已渲染图表里第一个非空标签通常就是业务主题
    var label = '';
    var svgEl = card.querySelector('.code-preview-stage svg');
    if (svgEl) {
        var fos = svgEl.querySelectorAll('foreignObject');
        for (var j = 0; j < fos.length; j++) {
            var text = (fos[j].textContent || '').replace(/\s+/g, ' ').trim();
            if (text) {
                label = text;
                break;
            }
        }
        if (!label) {
            var textEl = svgEl.querySelector('text');
            if (textEl) label = (textEl.textContent || '').replace(/\s+/g, ' ').trim();
        }
    }
    // 清理文件名非法字符并截断，避免过长
    label = label.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 30);
    return (label ? typeName + '-' + label : typeName) + '-' + buildExportTimestamp();
}

// html 导出的文件名主体：取 <title> 当业务名，拼时分秒；取不到兜底 preview
function buildHtmlFileBase(card) {
    var code = getCardCode(card);
    var match = code.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    var label = match ? match[1].replace(/\s+/g, ' ').trim() : '';
    // 清理文件名非法字符并截断，避免过长
    label = label.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 30);
    return (label || 'preview') + '-' + buildExportTimestamp();
}

// 把卡片里渲染好的 mermaid SVG 栅格化为 PNG 下载（2 倍清晰度，铺卡片底色防透明底看不清）
// 导出是异步的，菜单保持打开直到出结果，失败提示才不会被菜单关闭吞掉
function saveMermaidPng(card, option) {
    var svgEl = card.querySelector('.code-preview-stage svg');
    if (!svgEl) {
        // 懒加载下卡片可能尚未进视口渲染
        option.textContent = '图表未就绪';
        return;
    }
    option.textContent = '导出中…';
    var viewBox = svgEl.viewBox && svgEl.viewBox.baseVal;
    var rect = svgEl.getBoundingClientRect();
    var width = Math.ceil((viewBox && viewBox.width) || rect.width);
    var height = Math.ceil((viewBox && viewBox.height) || rect.height);
    if (!width || !height) {
        option.textContent = '导出失败';
        return;
    }

    var clone = svgEl.cloneNode(true);
    convertForeignObjectsToText(svgEl, clone);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', width);
    clone.setAttribute('height', height);
    var svgText = new XMLSerializer().serializeToString(clone);
    saveImageLog('start', 'size:', width, 'x', height, 'svgTextLength:', svgText.length);

    var fail = function (reason) {
        saveImageLog('failed:', reason);
        option.textContent = '导出失败';
        setTimeout(function () { option.textContent = '保存为图片'; }, 2500);
    };
    var succeed = function () {
        saveImageLog('done');
        option.textContent = '已保存';
        setTimeout(function () {
            option.textContent = '保存为图片';
            closeCardMenu(card);
        }, 800);
    };

    // SVG 图片加载偶发挂起（onload/onerror 都不触发），每次尝试用全新 blob 和 Image，最多 3 次
    var attemptsLeft = 3;
    (function attempt() {
        var svgUrl = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
        var settled = false;
        var img = new Image();
        saveImageLog('attempt', 4 - attemptsLeft, 'of 3');
        img.onload = function () {
            if (settled) return;
            settled = true;
            saveImageLog('image loaded', img.naturalWidth, 'x', img.naturalHeight);
            try {
                // 超长图表按 2 倍导出可能超出 canvas 上限，按需要自动降倍
                var scale = Math.min(2, 16000 / width, 16000 / height);
                var canvas = document.createElement('canvas');
                canvas.width = Math.floor(width * scale);
                canvas.height = Math.floor(height * scale);
                var ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('canvas 2d context unavailable');
                ctx.fillStyle = getComputedStyle(card).backgroundColor || '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                saveImageLog('drawn to canvas', canvas.width, 'x', canvas.height);
                setTimeout(function () { URL.revokeObjectURL(svgUrl); }, 1000);
                canvas.toBlob(function (png) {
                    saveImageLog('toBlob result:', png ? (png.size + ' bytes') : 'null');
                    if (png) {
                        downloadBlob(png, 'image/png', buildMermaidFileBase(card) + '.png');
                        succeed();
                    } else {
                        fail('canvas toBlob returned null');
                    }
                }, 'image/png');
            } catch (err) {
                saveImageLog('draw exception:', err && err.message);
                fail('draw exception: ' + (err && err.message));
            }
        };
        var retryOrFail = function (reason) {
            if (settled) return;
            settled = true;
            URL.revokeObjectURL(svgUrl);
            attemptsLeft -= 1;
            saveImageLog('attempt ended:', reason, 'attemptsLeft:', attemptsLeft);
            if (attemptsLeft > 0) attempt();
            else fail(reason);
        };
        img.onerror = function () { retryOrFail('image error'); };
        setTimeout(function () { retryOrFail('image load timeout'); }, 6000);
        img.src = svgUrl;
    })();
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
        // 保存为图片是异步导出，菜单开合与结果反馈由 saveMermaidPng 自己管理
        if (option.dataset.action === 'save-image') {
            saveMermaidPng(optionCard, option);
            return true;
        }
        handleMenuAction(optionCard, option.dataset.action, option);
        closeCardMenu(optionCard);
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
