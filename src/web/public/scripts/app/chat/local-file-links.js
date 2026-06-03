var LOCAL_FILE_RE = /(^|[\s(\[{<>"'“‘])((?:FILE:\s*)?)((?:file:\/\/[^\s<>"'`，。；;、]+|~[\\/][^\s<>"'`，。；;、]+|\/[^\s<>"'`，。；;、]+|[a-zA-Z]:[\\/][^\s<>"'`，。；;、]+|\\\\[^\\/\s<>"'`，。；;、]+[\\/][^\s<>"'`，。；;、]+))/gi;
var TRAILING_LOCAL_PATH_PUNCT_RE = /[\])}>.,，。；;、:：!！?？]+$/;

export function isLocalFilePath(value) {
    var filePath = String(value || '').trim();
    if (!filePath || /[\u0000-\u001f\u007f]/.test(filePath)) return false;

    try {
        filePath = decodeURI(filePath);
    } catch (_) {
    }

    if (/^file:/i.test(filePath)) return true;
    if (/^~[\\/]/.test(filePath)) return true;
    if (/^\//.test(filePath)) return true;
    if (/^[a-zA-Z]:[\\/]/.test(filePath)) return true;
    return /^\\\\[^\\\/]+[\\\/][^\\\/]+/.test(filePath);
}

function shouldSkipTextNode(node) {
    var parent = node && node.parentElement;
    if (!parent) return true;
    return !!parent.closest('pre, a, button, textarea, input, script, style');
}

function createFileAction(filePath) {
    return createActionButton({
        className: 'local-file-link',
        label: filePath,
        action: 'reveal',
        filePath: filePath,
    });
}

function createActionButton(options) {
    var button = document.createElement('button');
    button.className = options.className;
    button.type = 'button';
    button.textContent = options.label;
    button.setAttribute('aria-label', options.filePath);
    button.dataset.localFileAction = options.action;
    button.dataset.localFilePath = options.filePath;
    button.dataset.localFileBound = 'true';
    button.addEventListener('click', function () {
        runLocalFileAction(button, options.action, options.filePath);
    });
    return button;
}

function bindExistingFileActions(root) {
    var buttons = root.querySelectorAll('.local-file-link[data-local-file-path]');
    buttons.forEach(function (button) {
        if (button.dataset.localFileBound === 'true') return;
        button.dataset.localFileBound = 'true';
        button.addEventListener('click', function () {
            runLocalFileAction(
                button,
                button.dataset.localFileAction || 'reveal',
                button.dataset.localFilePath || ''
            );
        });
    });
}

async function runLocalFileAction(button, action, filePath) {
    if (button.disabled) return;
    button.disabled = true;
    button.classList.add('is-opening');

    try {
        await fetch(action === 'open' ? '/api/local-file/open' : '/api/local-file/reveal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: filePath }),
        });
    } catch (_) {
    } finally {
        button.disabled = false;
        button.classList.remove('is-opening');
    }
}

function trimLocalFilePath(filePath) {
    return String(filePath || '').replace(TRAILING_LOCAL_PATH_PUNCT_RE, '');
}

function replaceTextNode(node) {
    var text = node.nodeValue || '';
    LOCAL_FILE_RE.lastIndex = 0;
    if (!LOCAL_FILE_RE.test(text)) return;

    LOCAL_FILE_RE.lastIndex = 0;
    var fragment = document.createDocumentFragment();
    var lastIndex = 0;
    var match;

    while ((match = LOCAL_FILE_RE.exec(text))) {
        var start = match.index;
        var boundary = match[1] || '';
        var label = match[2] || '';
        var rawFilePath = String(match[3] || '').trim();
        var filePath = trimLocalFilePath(rawFilePath);
        var trailing = rawFilePath.slice(filePath.length);
        if (!filePath || !isLocalFilePath(filePath)) continue;

        if (start > lastIndex) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex, start)));
        }
        if (boundary) fragment.appendChild(document.createTextNode(boundary));
        fragment.appendChild(document.createTextNode(label));
        fragment.appendChild(createFileAction(filePath));
        if (trailing) fragment.appendChild(document.createTextNode(trailing));
        lastIndex = start + match[0].length;
    }

    if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    if (node.parentNode) {
        node.parentNode.replaceChild(fragment, node);
    }
}

export function enhanceLocalFileLinks(root) {
    if (!root) return;
    bindExistingFileActions(root);

    var nodeFilter = (window.NodeFilter && window.NodeFilter.SHOW_TEXT) || 4;
    var walker = document.createTreeWalker(root, nodeFilter, {
        acceptNode: function (node) {
            return shouldSkipTextNode(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        },
    });
    var nodes = [];
    var node = walker.nextNode();
    while (node) {
        nodes.push(node);
        node = walker.nextNode();
    }

    nodes.forEach(function (textNode) {
        replaceTextNode(textNode);
    });
    bindExistingFileActions(root);
}
