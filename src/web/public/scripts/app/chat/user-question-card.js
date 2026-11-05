import { escapeAttr, escapeHtml } from '../utils/html.js';

// 选项序号字母，超出后退回数字
var OPTION_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
// 用户跳过单个问题时回传给 Agent 的答案
var SKIPPED_ANSWER_TEXT = '（用户跳过了这个问题）';
// 单选题选中后自动翻到下一题的延迟
var AUTO_ADVANCE_DELAY_MS = 180;

// 选项序号：A、B、C…
function optionLetter(index) {
    return OPTION_LETTERS.charAt(index) || String(index + 1);
}

// 提问结束状态的展示文案
function statusText(status) {
    if (status === 'answered') return '已回答';
    if (status === 'skipped') return '已跳过';
    if (status === 'cancelled') return '已取消';
    return '未回答';
}

// 提交回答；提问已结束或校验失败时抛出服务端错误信息
async function postReply(sessionId, questionId, reply) {
    var res = await fetch(
        '/api/sessions/' + encodeURIComponent(sessionId) + '/questions/' + encodeURIComponent(questionId) + '/reply',
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reply),
        }
    );
    if (!res.ok) {
        var err = await res.json().catch(function () { return {}; });
        throw new Error(err.error || '提交回答失败');
    }
}

/**
 * 创建 Agent 提问卡片：分页展示问题，支持单选、多选和自定义答案，提交后收起为问答摘要。
 * readOnly 或缺少 sessionId 时只展示摘要（历史消息回放）。
 */
export function createUserQuestionCard(options) {
    var question = options.question || {};
    var questions = Array.isArray(question.questions) ? question.questions : [];
    var sessionId = options.sessionId || null;
    var interactive = !options.readOnly && !!sessionId;
    var scrollBottom = options.scrollBottom || function () {};
    var onResolved = options.onResolved || function () {};

    // 每题的作答草稿：选中的选项序号、自定义答案、是否被跳过
    var drafts = questions.map(function () {
        return { selected: [], otherText: '', skipped: false };
    });
    // 当前展示的问题序号
    var currentIndex = 0;
    // 卡片是否收起
    var collapsed = false;
    // 是否正在提交
    var submitting = false;
    // 提交失败的提示
    var errorText = '';
    // 提问结束后的状态与答案，null 表示仍在等待回答
    var resolved = null;
    // 单选后自动翻页的定时器
    var autoAdvanceTimer = null;

    var el = document.createElement('div');
    el.className = 'user-question-card';
    el.dataset.questionId = question.id || '';

    // 问题的预设选项
    function getOptions(item) {
        return Array.isArray(item && item.options) ? item.options : [];
    }

    // 是否填写了自定义答案
    function hasOtherAnswer(draft) {
        return !!String(draft.otherText || '').trim();
    }

    // 当前题是否已作答（选了选项或填了自定义答案）
    function isAnswered(draft) {
        return draft.selected.length > 0 || hasOtherAnswer(draft);
    }

    // 拼出回传给 Agent 的答案文本：单选取自定义答案或选中项，多选按选项顺序用逗号连接
    function buildAnswer(item, draft) {
        var labels = draft.selected.slice().sort(function (a, b) { return a - b; }).map(function (index) {
            var option = getOptions(item)[index];
            return option ? option.label : '';
        }).filter(Boolean);
        var otherText = String(draft.otherText || '').trim();
        if (!item.multiSelect) return otherText || labels[0] || '';
        if (otherText) labels.push(otherText);
        return labels.join(', ');
    }

    // 取消待执行的自动翻页
    function clearAutoAdvance() {
        if (!autoAdvanceTimer) return;
        clearTimeout(autoAdvanceTimer);
        autoAdvanceTimer = null;
    }

    // 渲染待回答状态：当前问题、选项、分页和操作按钮
    function renderPending() {
        var item = questions[currentIndex];
        var draft = drafts[currentIndex];
        var isLast = currentIndex === questions.length - 1;
        var itemOptions = getOptions(item);
        var html = '' +
            '<div class="uq-head">' +
            '<span class="uq-title">问题</span>' +
            (item.header ? '<span class="uq-chip">' + escapeHtml(item.header) + '</span>' : '') +
            (collapsed && questions.length > 1 ? '<span class="uq-head-meta">' + (currentIndex + 1) + ' / ' + questions.length + '</span>' : '') +
            '<button type="button" class="uq-collapse" data-action="collapse" title="' + (collapsed ? '展开' : '收起') + '" aria-label="' + (collapsed ? '展开' : '收起') + '">' +
            (collapsed ? '+' : '–') +
            '</button>' +
            '</div>';

        if (collapsed) {
            el.innerHTML = html;
            return;
        }

        html += '<div class="uq-body">' +
            '<div class="uq-question">' + escapeHtml(item.question) + '</div>' +
            (item.multiSelect ? '<div class="uq-hint">可多选</div>' : '') +
            '<div class="uq-options" role="listbox" aria-multiselectable="' + (item.multiSelect ? 'true' : 'false') + '">';
        itemOptions.forEach(function (option, index) {
            var selected = draft.selected.indexOf(index) !== -1;
            html += '<button type="button" class="uq-option' + (selected ? ' selected' : '') + '" data-option-index="' + index + '" role="option" aria-selected="' + (selected ? 'true' : 'false') + '">' +
                '<span class="uq-letter">' + optionLetter(index) + '</span>' +
                '<span class="uq-option-main">' +
                '<span class="uq-option-label">' + escapeHtml(option.label) + '</span>' +
                (option.description ? '<span class="uq-option-desc">' + escapeHtml(option.description) + '</span>' : '') +
                '</span>' +
                '</button>';
        });
        html += '<label class="uq-option uq-other' + (hasOtherAnswer(draft) ? ' selected' : '') + '">' +
            '<span class="uq-letter">' + optionLetter(itemOptions.length) + '</span>' +
            '<input type="text" class="uq-other-input" data-role="other" placeholder="其他…" value="' + escapeAttr(draft.otherText) + '">' +
            '</label>' +
            '</div>' +
            '</div>';

        html += '<div class="uq-foot">';
        if (questions.length > 1) {
            html += '<div class="uq-pager">' +
                '<button type="button" class="uq-page-btn" data-action="prev" aria-label="上一题"' + (currentIndex === 0 ? ' disabled' : '') + '>‹</button>' +
                '<span>' + (currentIndex + 1) + ' / ' + questions.length + '</span>' +
                '<button type="button" class="uq-page-btn" data-action="forward" aria-label="下一题"' + (isLast ? ' disabled' : '') + '>›</button>' +
                '</div>';
        }
        if (errorText) html += '<div class="uq-error">' + escapeHtml(errorText) + '</div>';
        html += '<div class="uq-actions">' +
            '<button type="button" class="uq-btn secondary" data-action="skip"' + (submitting ? ' disabled' : '') + '>跳过</button>' +
            '<button type="button" class="uq-btn primary" data-action="next"' + (submitting || !isAnswered(draft) ? ' disabled' : '') + '>' +
            (submitting ? '提交中…' : (isLast ? '提交' : '下一题')) +
            '</button>' +
            '</div>' +
            '</div>';
        el.innerHTML = html;
    }

    // 渲染结束状态：逐题展示问题与答案。已回答时不展示「问题」标题和「已回答」状态。
    function renderSummary() {
        var status = resolved ? resolved.status : 'unanswered';
        var answers = (resolved && resolved.answers) || {};
        var html = '';
        if (status !== 'answered') {
            html += '<div class="uq-head">' +
                '<span class="uq-status ' + escapeHtml(status) + '">' + statusText(status) + '</span>' +
                '</div>';
        }
        html += '<div class="uq-summary">';
        questions.forEach(function (item) {
            var answer = answers[item.question];
            html += '<div class="uq-summary-item">' +
                '<div class="uq-summary-question">' + escapeHtml(item.question) + '</div>' +
                '<div class="uq-summary-answer' + (answer ? '' : ' empty') + '">' + escapeHtml(answer || statusText(status)) + '</div>' +
                '</div>';
        });
        html += '</div>';
        el.innerHTML = html;
    }

    // 按当前状态整体重绘卡片
    function render() {
        var showSummary = !!resolved || !interactive || questions.length === 0;
        el.classList.toggle('resolved', showSummary);
        el.classList.toggle('collapsed', !showSummary && collapsed);
        if (showSummary) {
            renderSummary();
        } else {
            renderPending();
        }
    }

    // 只同步选中态和按钮状态，不重建 DOM，避免自定义输入框丢失焦点
    function syncSelectionState() {
        var draft = drafts[currentIndex];
        el.querySelectorAll('.uq-option[data-option-index]').forEach(function (optionEl) {
            var index = Number(optionEl.getAttribute('data-option-index'));
            var selected = draft.selected.indexOf(index) !== -1;
            optionEl.classList.toggle('selected', selected);
            optionEl.setAttribute('aria-selected', selected ? 'true' : 'false');
        });
        var otherEl = el.querySelector('.uq-other');
        if (otherEl) otherEl.classList.toggle('selected', hasOtherAnswer(draft));
        var nextBtn = el.querySelector('[data-action="next"]');
        if (nextBtn) nextBtn.disabled = submitting || !isAnswered(draft);
    }

    // 切换到指定问题
    function goTo(index) {
        clearAutoAdvance();
        if (index < 0 || index >= questions.length) return;
        currentIndex = index;
        errorText = '';
        render();
    }

    // 选择选项：多选切换选中态；单选替换答案并自动翻到下一题
    function selectOption(index) {
        var item = questions[currentIndex];
        var draft = drafts[currentIndex];
        if (index < 0 || index >= getOptions(item).length) return;
        draft.skipped = false;
        if (item.multiSelect) {
            var position = draft.selected.indexOf(index);
            if (position === -1) {
                draft.selected.push(index);
            } else {
                draft.selected.splice(position, 1);
            }
            syncSelectionState();
            return;
        }
        draft.selected = [index];
        draft.otherText = '';
        var otherInput = el.querySelector('[data-role="other"]');
        if (otherInput) otherInput.value = '';
        syncSelectionState();
        if (currentIndex < questions.length - 1) {
            clearAutoAdvance();
            var fromIndex = currentIndex;
            autoAdvanceTimer = setTimeout(function () {
                autoAdvanceTimer = null;
                if (!resolved && currentIndex === fromIndex) goTo(fromIndex + 1);
            }, AUTO_ADVANCE_DELAY_MS);
        }
    }

    // 输入自定义答案；单选题填写后清空已选选项
    function handleOtherInput(value) {
        var item = questions[currentIndex];
        var draft = drafts[currentIndex];
        draft.otherText = value;
        draft.skipped = false;
        if (!item.multiSelect && String(value || '').trim()) draft.selected = [];
        syncSelectionState();
    }

    // 提交全部答案；未作答的题回传跳过说明，全部未作答时按「跳过全部」提交
    async function submit() {
        if (submitting || resolved) return;
        var answers = {};
        var answeredCount = 0;
        questions.forEach(function (item, index) {
            var draft = drafts[index];
            var answer = !draft.skipped && isAnswered(draft) ? buildAnswer(item, draft) : '';
            if (answer) {
                answers[item.question] = answer;
                answeredCount += 1;
            } else {
                answers[item.question] = SKIPPED_ANSWER_TEXT;
            }
        });
        var reply = answeredCount > 0 ? { action: 'answer', answers: answers } : { action: 'skip' };

        submitting = true;
        errorText = '';
        render();
        try {
            await postReply(sessionId, question.id, reply);
            submitting = false;
            resolve({
                status: reply.action === 'skip' ? 'skipped' : 'answered',
                answers: reply.answers,
            });
        } catch (error) {
            submitting = false;
            errorText = error.message || '提交回答失败';
            render();
        }
    }

    // 下一题；最后一题时提交
    function handleNext() {
        var draft = drafts[currentIndex];
        if (!isAnswered(draft)) return;
        draft.skipped = false;
        if (currentIndex < questions.length - 1) {
            goTo(currentIndex + 1);
            return;
        }
        submit();
    }

    // 跳过当前题；最后一题时提交
    function handleSkip() {
        drafts[currentIndex].skipped = true;
        if (currentIndex < questions.length - 1) {
            goTo(currentIndex + 1);
            return;
        }
        submit();
    }

    el.addEventListener('click', function (event) {
        if (resolved || !interactive) return;
        var actionEl = event.target.closest('[data-action]');
        if (actionEl && el.contains(actionEl)) {
            if (actionEl.disabled) return;
            var action = actionEl.getAttribute('data-action');
            if (action === 'collapse') {
                collapsed = !collapsed;
                render();
            } else if (action === 'prev') {
                goTo(currentIndex - 1);
            } else if (action === 'forward') {
                goTo(currentIndex + 1);
            } else if (action === 'next') {
                handleNext();
            } else if (action === 'skip') {
                handleSkip();
            }
            return;
        }
        var optionEl = event.target.closest('[data-option-index]');
        if (optionEl && el.contains(optionEl) && !submitting) {
            selectOption(Number(optionEl.getAttribute('data-option-index')));
        }
    });

    el.addEventListener('input', function (event) {
        if (resolved || !interactive || submitting) return;
        if (event.target && event.target.getAttribute('data-role') === 'other') {
            handleOtherInput(event.target.value);
        }
    });

    el.addEventListener('keydown', function (event) {
        if (resolved || !interactive || submitting || collapsed) return;
        if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
        var isOtherInput = event.target && event.target.getAttribute && event.target.getAttribute('data-role') === 'other';
        if (isOtherInput) {
            if (event.key === 'Enter') {
                event.preventDefault();
                handleNext();
            }
            return;
        }
        if (event.key.length !== 1) return;
        var index = OPTION_LETTERS.indexOf(event.key.toUpperCase());
        if (index === -1) return;
        var itemOptions = getOptions(questions[currentIndex]);
        if (index < itemOptions.length) {
            event.preventDefault();
            selectOption(index);
        } else if (index === itemOptions.length) {
            event.preventDefault();
            var otherInput = el.querySelector('[data-role="other"]');
            if (otherInput) otherInput.focus();
        }
    });

    /** 提问结束（已回答、已跳过或已取消）后收起为问答摘要 */
    function resolve(result) {
        clearAutoAdvance();
        var next = result || {};
        resolved = {
            status: next.status || 'answered',
            answers: next.answers || (resolved && resolved.answers) || null,
        };
        render();
        onResolved();
        scrollBottom();
    }

    /** 本轮结束时仍未回答的提问标记为未回答 */
    function finish() {
        if (resolved) return;
        resolve({ status: 'unanswered' });
    }

    /** 是否仍在等待用户回答 */
    function isPending() {
        return interactive && !resolved;
    }

    render();

    return {
        el: el,
        resolve: resolve,
        finish: finish,
        isPending: isPending,
    };
}
