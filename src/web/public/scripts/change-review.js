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

    function renderFile(file, openPaths) {
        var status = file.status || 'modified';
        var open = openPaths && openPaths.has(file.path) ? ' open' : '';
        return '' +
            '<details class="change-review-file" data-file-path="' + escapeAttr(file.path) + '"' + open + '>' +
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
            renderFileBody(file) +
            '</details>';
    }

    function renderInner(review, openPaths) {
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
            '<div class="change-review-files">' + files.map(function (file) { return renderFile(file, openPaths); }).join('') + '</div>' +
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
        var openPaths = new Set();
        container.className = 'change-review-card';
        container.dataset.reviewId = review.id;
        container.innerHTML = renderInner(review, openPaths);

        function update(nextReview) {
            review = nextReview || review;
            container.innerHTML = renderInner(review, openPaths);
            bindActions();
            bindFileState();
            bindDiffLoaders();
            if (opts.scrollBottom) opts.scrollBottom();
        }

        function replaceReviewFile(nextFile) {
            var files = (Array.isArray(review.files) ? review.files : []).map(function (file) {
                if (file.path !== nextFile.path) return file;
                return Object.assign({}, file, nextFile, {
                    diffTruncated: false,
                    fullDiffAvailable: false,
                });
            });
            update(Object.assign({}, review, { files: files }));
        }

        function bindFileState() {
            container.querySelectorAll('.change-review-file[data-file-path]').forEach(function (el) {
                el.addEventListener('toggle', function () {
                    var filePath = el.getAttribute('data-file-path') || '';
                    if (!filePath) return;
                    if (el.open) {
                        openPaths.add(filePath);
                    } else {
                        openPaths.delete(filePath);
                    }
                });
            });
        }

        function bindDiffLoaders() {
            container.querySelectorAll('[data-load-full-diff]').forEach(function (btn) {
                btn.addEventListener('click', async function (event) {
                    event.preventDefault();
                    event.stopPropagation();
                    var filePath = btn.getAttribute('data-file-path') || '';
                    if (!filePath) return;
                    btn.disabled = true;
                    btn.textContent = '加载中…';
                    try {
                        var file = await loadFullDiff(review.id, filePath);
                        openPaths.add(filePath);
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
                        update(nextReview);
                    } catch (error) {
                        update(Object.assign({}, review, {
                            error: error.message || '操作失败',
                        }));
                    }
                });
            });
        }

        bindActions();
        bindFileState();
        bindDiffLoaders();
        return container;
    }

    window.ChangeReview = {
        render: render,
        renderDiff: renderDiff,
    };
})();
