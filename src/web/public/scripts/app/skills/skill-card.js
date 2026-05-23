import { escapeHtml } from '../utils/html.js';

export function showSkillsSaveStatus(message) {
    var el = document.getElementById('skills-save-status');
    if (!el) return;

    el.innerHTML =
        '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6.5l2.5 2.5L10 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg> ' +
        escapeHtml(message);
    el.style.opacity = '1';
    clearTimeout(el._timer);
    el._timer = setTimeout(function () {
        el.innerHTML =
            '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6.5l2.5 2.5L10 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg> 所有更改已保存';
    }, 3000);
}

export function createSkillCard(skill, options) {
    var card = document.createElement('div');
    card.className = 'skill-card';
    card.dataset.skillId = skill.id;

    var top = document.createElement('div');
    top.className = 'skill-card-top';

    var info = document.createElement('div');
    info.className = 'skill-card-info';
    info.innerHTML =
        '<div class="skill-card-name">' + escapeHtml(skill.name) + '</div>' +
        '<div class="skill-card-desc">' + escapeHtml(skill.description || '暂无描述') + '</div>';

    var actions = document.createElement('div');
    actions.className = 'skill-card-actions';

    actions.appendChild(createSkillToggle(skill, options));
    actions.appendChild(createOpenFolderButton(skill, options));
    actions.appendChild(createDeleteButton(skill, card, options));

    top.appendChild(info);
    top.appendChild(actions);
    card.appendChild(top);
    card.appendChild(createSkillDetail(skill));

    return card;
}

function createSkillToggle(skill, options) {
    var toggle = document.createElement('button');
    toggle.className = 'skill-toggle' + (skill.enabled ? ' on' : '');
    toggle.title = skill.enabled ? '点击禁用' : '点击启用';

    toggle.addEventListener('click', function () {
        var newState = !toggle.classList.contains('on');
        setToggleState(toggle, skill, newState);

        var providerType = options.getProviderType();
        fetch('/api/skills/' + encodeURIComponent(skill.id) + '/toggle' + options.getProviderQuery(providerType), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: newState }),
        }).then(function (res) {
            if (!res.ok) throw new Error('toggle failed');
            options.invalidateSlashItemsData(providerType);
            options.showSaveStatus(newState ? '已启用: ' + skill.name : '已禁用: ' + skill.name);
        }).catch(function () {
            setToggleState(toggle, skill, !newState);
            options.showError('切换技能状态失败');
        });
    });

    return toggle;
}

function setToggleState(toggle, skill, enabled) {
    toggle.classList.toggle('on', enabled);
    toggle.title = enabled ? '点击禁用' : '点击启用';
    skill.enabled = enabled;
}

function createOpenFolderButton(skill, options) {
    var openBtn = document.createElement('button');
    openBtn.className = 'skill-open-btn';
    openBtn.title = '打开文件夹';
    openBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 3v6.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H6L4.5 3H2a1 1 0 0 0-1 1z" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    openBtn.addEventListener('click', function () {
        fetch('/api/skills/open-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path: skill.fullPath,
                provider: options.getProviderType(),
            }),
        });
    });

    return openBtn;
}

function createDeleteButton(skill, card, options) {
    var delBtn = document.createElement('button');
    delBtn.className = 'skill-delete-btn';
    delBtn.title = '删除技能';
    delBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 3h8M4.5 3V2a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1M3 3v7a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V3" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    delBtn.addEventListener('click', function () {
        if (!confirm('确定要删除技能 "' + skill.name + '" 吗？此操作不可撤销。')) return;

        var providerType = options.getProviderType();
        fetch('/api/skills/' + encodeURIComponent(skill.id) + options.getProviderQuery(providerType), {
            method: 'DELETE',
        }).then(function (res) {
            if (!res.ok) {
                options.showError('删除技能失败');
                return;
            }

            card.style.transition = 'opacity 0.2s, transform 0.2s';
            card.style.opacity = '0';
            card.style.transform = 'translateX(10px)';
            setTimeout(function () {
                card.remove();
                options.onDeleted(skill, providerType);
            }, 200);
        }).catch(function () {
            options.showError('删除技能失败');
        });
    });

    return delBtn;
}

function createSkillDetail(skill) {
    var expand = document.createElement('div');
    expand.className = 'skill-card-expand';

    var expandBtn = document.createElement('button');
    expandBtn.className = 'skill-expand-btn';
    expandBtn.innerHTML = '查看详情 <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    var detail = document.createElement('div');
    detail.className = 'skill-detail';
    detail.innerHTML =
        '<div class="skill-detail-path">📁 ' + escapeHtml(skill.fullPath) + '</div>' +
        '<div class="skill-detail-content">' + escapeHtml(skill.content) + '</div>';

    expandBtn.addEventListener('click', function () {
        var isOpen = detail.classList.contains('show');
        detail.classList.toggle('show');
        expandBtn.classList.toggle('open');
        expandBtn.innerHTML = (isOpen ? '查看详情' : '收起详情') +
            ' <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    });

    expand.appendChild(expandBtn);
    expand.appendChild(detail);

    return expand;
}
