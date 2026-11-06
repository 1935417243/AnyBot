(function () {
    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function escapeAttr(value) {
        return escapeHtml(value).replace(/"/g, '&quot;');
    }

    function signedCount(value, sign) {
        return sign + String(Math.max(0, value || 0));
    }

    function isBinaryDiffText(diff) {
        return /(?:^|\n)(?:Binary files .* differ|GIT binary patch)(?:\n|$)/.test(String(diff || ''));
    }

    function isTextDiffFile(file) {
        if (!file) return true;
        if (file.diffType) return file.diffType !== 'binary';
        return !isBinaryDiffText(file.diff);
    }

    function statusText(status) {
        if (status === 'approved') return '已通过';
        if (status === 'reverted') return '已撤销';
        return '待审核';
    }

    function statusLabel(status) {
        if (status === 'added') return '新增';
        if (status === 'deleted') return '删除';
        return '修改';
    }

    function parseHunkHeader(line) {
        var match = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)$/.exec(line);
        if (!match) return null;
        return {
            oldStart: Number(match[1]),
            newStart: Number(match[3]),
            label: String(match[5] || '').trim(),
        };
    }

    function isDiffHeader(line) {
        return (
            line.startsWith('diff --git') ||
            line.startsWith('index ') ||
            line.startsWith('old mode ') ||
            line.startsWith('new mode ') ||
            line.startsWith('deleted file mode ') ||
            line.startsWith('new file mode ') ||
            line.startsWith('similarity index ') ||
            line.startsWith('dissimilarity index ') ||
            line.startsWith('rename from ') ||
            line.startsWith('rename to ') ||
            line.startsWith('copy from ') ||
            line.startsWith('copy to ') ||
            line.startsWith('---') ||
            line.startsWith('+++')
        );
    }

    function lineNumber(value) {
        return typeof value === 'number' && value > 0 ? String(value) : '';
    }

    function displayLineNumber(cls, oldNumber, newNumber) {
        if (cls === 'del') return lineNumber(oldNumber);
        return lineNumber(newNumber) || lineNumber(oldNumber);
    }

    function renderDiffLine(cls, oldNumber, newNumber, content) {
        return '' +
            '<div class="change-review-diff-row ' + cls + '" role="row">' +
            '<span class="change-review-line-num" role="cell">' + escapeHtml(displayLineNumber(cls, oldNumber, newNumber)) + '</span>' +
            '<span class="change-review-code" role="cell">' +
            '<span class="change-review-code-text">' + escapeHtml(content || ' ') + '</span>' +
            '</span>' +
            '</div>';
    }

    function renderDiff(diff) {
        var lines = String(diff || '').split('\n');
        var rendered = [];
        var oldLine = null;
        var newLine = null;

        lines.forEach(function (line) {
            var cls = 'ctx';
            var content = line;

            if (isDiffHeader(line)) {
                return;
            }

            if (line === 'Binary files differ') {
                rendered.push(renderDiffLine('meta', null, null, '二进制文件有变化'));
                return;
            }

            if (line.startsWith('\\')) {
                rendered.push(renderDiffLine('meta', null, null, line));
                return;
            }

            if (line.startsWith('@@')) {
                var hunk = parseHunkHeader(line);
                if (hunk) {
                    oldLine = hunk.oldStart;
                    newLine = hunk.newStart;
                }
                return;
            }

            if (line.startsWith('+')) {
                cls = 'add';
                content = line.slice(1);
                rendered.push(renderDiffLine(cls, null, newLine, content));
                if (typeof newLine === 'number') newLine += 1;
                return;
            } else if (line.startsWith('-')) {
                cls = 'del';
                content = line.slice(1);
                rendered.push(renderDiffLine(cls, oldLine, null, content));
                if (typeof oldLine === 'number') oldLine += 1;
                return;
            } else if (line.startsWith(' ')) {
                content = line.slice(1);
            }

            rendered.push(renderDiffLine(cls, oldLine, newLine, content));
            if (typeof oldLine === 'number') oldLine += 1;
            if (typeof newLine === 'number') newLine += 1;
        });

        return rendered.join('') || renderDiffLine('meta', null, null, '没有可展示的文本变化');
    }

    function renderReviewCounts(review, files) {
        if ((review.totalAdditions || 0) === 0 && (review.totalDeletions || 0) === 0) {
            var hasResourceChange = files.some(function (file) { return !isTextDiffFile(file); });
            if (hasResourceChange) return '<span class="change-review-count-label">资源变更</span>';
        }
        return '' +
            '<span class="add">' + signedCount(review.totalAdditions, '+') + '</span>' +
            '<span class="del">' + signedCount(review.totalDeletions, '-') + '</span>';
    }

    function renderFileCounts(file) {
        if (!isTextDiffFile(file)) {
            return '<span class="change-review-count-label">资源</span>';
        }
        return '' +
            '<span class="add">' + signedCount(file.additions, '+') + '</span>' +
            '<span class="del">' + signedCount(file.deletions, '-') + '</span>';
    }

    function renderTruncatedNotice(file) {
        if (!file.diffTruncated) return '';
        return '' +
            '<div class="change-review-diff-load">' +
            '<span>Diff 较大，当前仅展示摘要。</span>' +
            '<button class="change-review-btn secondary" type="button" data-load-full-diff data-file-path="' + escapeAttr(file.path) + '">查看完整 diff</button>' +
            '</div>';
    }

    function renderFileBody(file) {
        if (!isTextDiffFile(file)) {
            return '<div class="change-review-file-note">媒体或二进制资源已变更，不展示代码 diff。</div>';
        }
        return '' +
            renderTruncatedNotice(file) +
            '<div class="change-review-diff-wrap">' +
            '<div class="change-review-diff" role="table" aria-label="代码差异">' +
            renderDiff(file.diff) +
            '</div>' +
            '</div>';
    }

    // 文件默认折叠且只渲染标题行，diff 内容在首次展开时由 render() 惰性生成
    function renderFile(file) {
        var status = file.status || 'modified';
        return '' +
            '<details class="change-review-file" data-file-path="' + escapeAttr(file.path) + '">' +
            '<summary class="change-review-file-header">' +
            '<span class="change-review-file-main">' +
            '<span class="change-review-file-path" title="' + escapeAttr(file.path) + '">' + escapeHtml(file.path) + '</span>' +
            '<span class="change-review-file-status ' + escapeAttr(status) + '">' + statusLabel(status) + '</span>' +
            '</span>' +
            '<span class="change-review-file-meta">' +
            '<span class="change-review-file-counts">' +
            renderFileCounts(file) +
            '</span>' +
            '<span class="change-review-file-toggle" aria-hidden="true" title="展开/收起">' +
            '<svg viewBox="0 0 16 16" fill="none"><path d="M4.5 6.25 8 9.75l3.5-3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            '</span>' +
            '</span>' +
            '</summary>' +
            '</details>';
    }

    function renderInner(review) {
        var disabled = review.status !== 'pending' ? ' disabled' : '';
        var files = Array.isArray(review.files) ? review.files : [];
        return '' +
            '<div class="change-review-header">' +
            '<div>' +
            '<div class="change-review-title">已编辑 ' + (review.fileCount || files.length) + ' 个文件</div>' +
            '<div class="change-review-state">' + statusText(review.status) + '</div>' +
            '</div>' +
            '<div class="change-review-total">' +
            renderReviewCounts(review, files) +
            '</div>' +
            '</div>' +
            '<div class="change-review-files">' + files.map(function (file) { return renderFile(file); }).join('') + '</div>' +
            (review.error ? '<div class="change-review-error">' + escapeHtml(review.error) + '</div>' : '') +
            '<div class="change-review-actions">' +
            '<button class="change-review-btn secondary" data-action="revert"' + disabled + '>撤销</button>' +
            '<button class="change-review-btn primary" data-action="approve"' + disabled + '>通过</button>' +
            '</div>';
    }

    async function runAction(reviewId, action) {
        var res = await fetch('/api/change-reviews/' + encodeURIComponent(reviewId) + '/' + action, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok && !data.review) {
            throw new Error(data.error || '操作失败');
        }
        return data.review || null;
    }

    async function loadFullDiff(reviewId, filePath) {
        var res = await fetch(
            '/api/change-reviews/' + encodeURIComponent(reviewId) + '/diff?path=' + encodeURIComponent(filePath)
        );
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.file) {
            throw new Error(data.error || '读取完整 diff 失败');
        }
        return data.file;
    }

    function render(opts) {
        var review = opts.review;
        if (!review || !review.id || !Array.isArray(review.files) || review.files.length === 0) return null;

        var container = document.createElement('div');
        container.className = 'change-review-card';
        container.dataset.reviewId = review.id;
        container.innerHTML = renderInner(review);

        /** 按路径查找当前审核数据中的文件 */
        function findReviewFile(filePath) {
            var files = Array.isArray(review.files) ? review.files : [];
            for (var i = 0; i < files.length; i += 1) {
                if (files[i].path === filePath) return files[i];
            }
            return null;
        }

        /** 按路径查找文件对应的 details 元素；路径可能含特殊字符，不拼 CSS 选择器 */
        function findFileElement(filePath) {
            var items = container.querySelectorAll('.change-review-file[data-file-path]');
            for (var i = 0; i < items.length; i += 1) {
                if (items[i].getAttribute('data-file-path') === filePath) return items[i];
            }
            return null;
        }

        /** 只重建单个文件 details 内的 diff 区域，保留标题行和其它文件节点 */
        function renderFileBodyInto(el, file) {
            Array.prototype.slice.call(el.children).forEach(function (child) {
                if (child.tagName !== 'SUMMARY') child.remove();
            });
            el.insertAdjacentHTML('beforeend', renderFileBody(file));
            el.setAttribute('data-body-rendered', '1');
            bindDiffLoaders(el);
        }

        /** 文件首次展开时才生成 diff 节点，折叠态不创建逐行 DOM */
        function ensureFileBody(el) {
            if (el.hasAttribute('data-body-rendered')) return;
            var file = findReviewFile(el.getAttribute('data-file-path') || '');
            if (file) renderFileBodyInto(el, file);
        }

        /** 根据 review.error 新增、更新或移除错误提示 */
        function updateErrorNotice() {
            var errorEl = container.querySelector('.change-review-error');
            if (!review.error) {
                if (errorEl) errorEl.remove();
                return;
            }
            if (!errorEl) {
                errorEl = document.createElement('div');
                errorEl.className = 'change-review-error';
                container.insertBefore(errorEl, container.querySelector('.change-review-actions'));
            }
            errorEl.textContent = review.error;
        }

        /** 按审核状态恢复操作按钮的文案和禁用状态 */
        function updateActionButtons() {
            var disabled = review.status !== 'pending';
            container.querySelectorAll('[data-action]').forEach(function (btn) {
                btn.disabled = disabled;
                btn.textContent = btn.getAttribute('data-action') === 'revert' ? '撤销' : '通过';
            });
        }

        /** 审核状态变化后只刷新状态文案、错误提示和按钮，不重建文件列表 */
        function updateReviewState(nextReview) {
            if (nextReview) {
                // 文件列表沿用本地数据，避免已加载的完整 diff 被服务端摘要覆盖
                review = Object.assign({}, nextReview, { files: review.files });
            }
            var stateEl = container.querySelector('.change-review-state');
            if (stateEl) stateEl.textContent = statusText(review.status);
            updateErrorNotice();
            updateActionButtons();
            if (opts.scrollBottom) opts.scrollBottom();
        }

        function replaceReviewFile(nextFile) {
            var mergedFile = null;
            var files = (Array.isArray(review.files) ? review.files : []).map(function (file) {
                if (file.path !== nextFile.path) return file;
                mergedFile = Object.assign({}, file, nextFile, {
                    diffTruncated: false,
                    fullDiffAvailable: false,
                });
                return mergedFile;
            });
            review = Object.assign({}, review, { files: files });
            var el = mergedFile ? findFileElement(mergedFile.path) : null;
            if (el) renderFileBodyInto(el, mergedFile);
            if (opts.scrollBottom) opts.scrollBottom();
        }

        function bindFileState() {
            container.querySelectorAll('.change-review-file[data-file-path]').forEach(function (el) {
                el.addEventListener('toggle', function () {
                    if (el.open) ensureFileBody(el);
                });
            });
        }

        /** 为指定范围内的「查看完整 diff」按钮绑定加载逻辑 */
        function bindDiffLoaders(root) {
            root.querySelectorAll('[data-load-full-diff]').forEach(function (btn) {
                btn.addEventListener('click', async function (event) {
                    event.preventDefault();
                    event.stopPropagation();
                    var filePath = btn.getAttribute('data-file-path') || '';
                    if (!filePath) return;
                    btn.disabled = true;
                    btn.textContent = '加载中…';
                    try {
                        var file = await loadFullDiff(review.id, filePath);
                        replaceReviewFile(file);
                    } catch (error) {
                        btn.disabled = false;
                        btn.textContent = error.message || '加载失败';
                    }
                });
            });
        }

        function bindActions() {
            container.querySelectorAll('[data-action]').forEach(function (btn) {
                btn.addEventListener('click', async function () {
                    var action = btn.getAttribute('data-action');
                    if (!action || review.status !== 'pending') return;
                    btn.disabled = true;
                    btn.textContent = action === 'revert' ? '撤销中…' : '通过中…';
                    try {
                        var nextReview = await runAction(review.id, action === 'revert' ? 'revert' : 'approve');
                        updateReviewState(nextReview);
                    } catch (error) {
                        updateReviewState(Object.assign({}, review, {
                            error: error.message || '操作失败',
                        }));
                    }
                });
            });
        }

        bindActions();
        bindFileState();
        return container;
    }

    window.ChangeReview = {
        render: render,
        renderDiff: renderDiff,
    };
})();
