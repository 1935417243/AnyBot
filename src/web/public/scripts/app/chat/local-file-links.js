var LOCAL_FILE_RE = /\b(FILE:\s*)((?:file:\/\/[^\r\n<>]*?|(?:\/(?:Users|home|private|tmp|var|Volumes|Applications|opt|usr|etc)(?:\/|$)|[a-zA-Z]:[\\/]|\\\\[^\\/\r\n<>]+[\\/])[^\r\n<>]*?\.[A-Za-z0-9]{1,12})(?=$|[\s"'<>),，。；;]))/gi;

function shouldSkipTextNode(node) {
    var parent = node && node.parentElement;
    if (!parent) return true;
    return !!parent.closest('pre, code, a, button, textarea, input, script, style');
}

function isHtmlFilePath(filePath) {
    var value = String(filePath || '').trim().toLowerCase();
    try {
        value = decodeURI(value);
    } catch (_) {
    }
    return /\.html?$/.test(value);
}

function createFileAction(filePath) {
    return createActionButton({
        className: 'local-file-link',
        label: filePath,
        action: isHtmlFilePath(filePath) ? 'open' : 'reveal',
        filePath: filePath,
    });
}

function createActionButton(options) {
    var button = document.createElement('button');
    button.className = options.className;
    button.type = 'button';
    button.textContent = options.label;
    button.setAttribute('aria-label', options.filePath);
    button.addEventListener('click', function () {
        runLocalFileAction(button, options.action, options.filePath);
    });
    return button;
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
        var label = match[1] || '';
        var filePath = String(match[2] || '').trim();

        if (start > lastIndex) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex, start)));
        }
        fragment.appendChild(document.createTextNode(label));
        fragment.appendChild(createFileAction(filePath));
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
}
