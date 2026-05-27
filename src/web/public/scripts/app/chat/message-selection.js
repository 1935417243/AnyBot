import { escapeHtml } from '../utils/html.js';

export function getSkillIconHtml(className) {
    return '<svg class="' + className + '" viewBox="0 0 14 14" fill="none" aria-hidden="true">' +
        '<path d="M7 1.2 11.7 3.9v5.4L7 12 2.3 9.3V3.9L7 1.2Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>' +
        '<path d="M2.6 4.1 7 6.7l4.4-2.6M7 6.7V12" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>';
}

export function getProjectIconHtml(className) {
    return '<svg class="' + className + '" viewBox="0 0 14 14" fill="none" aria-hidden="true">' +
        '<path d="M1.5 4.2v6.6a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V5.5a1 1 0 0 0-1-1H7L5.7 3.1H2.5a1 1 0 0 0-1 1.1Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>' +
        '</svg>';
}

export function getCommandIconHtml(className) {
    return '<svg class="' + className + '" viewBox="0 0 14 14" fill="none" aria-hidden="true">' +
        '<path d="M2.2 4.2 5 7l-2.8 2.8M6.5 10h5.3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>';
}

export function getFileIconHtml(className) {
    return '<svg class="' + className + '" viewBox="0 0 14 14" fill="none" aria-hidden="true">' +
        '<path d="M3.2 1.6h4.4l3.2 3.2v7.6H3.2V1.6Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>' +
        '<path d="M7.6 1.8v3h3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>';
}

export function normalizeMessageSkills(skills) {
    if (!Array.isArray(skills)) return [];
    var seen = {};
    var normalized = [];
    skills.forEach(function (skill) {
        var name = String(skill && skill.name || '').trim();
        if (!name || seen[name]) return;
        seen[name] = true;
        normalized.push({
            id: skill && skill.id ? String(skill.id) : '',
            name: name,
        });
    });
    return normalized;
}

export function normalizeMessageProjects(projectList) {
    if (!Array.isArray(projectList)) return [];
    var seen = {};
    var normalized = [];
    projectList.forEach(function (project) {
        var id = String(project && project.id || '').trim();
        var pathValue = String(project && project.path || '').trim();
        var name = String(project && project.name || '').trim();
        var key = id || pathValue || name;
        if (!key || seen[key]) return;
        seen[key] = true;
        normalized.push({
            id: id,
            name: name || pathValue || id,
            path: pathValue,
        });
    });
    return normalized;
}

export function normalizeMessageFileReferences(files) {
    if (!Array.isArray(files)) return [];
    var seen = {};
    var normalized = [];
    files.forEach(function (file) {
        var pathValue = String(file && file.path || '').trim();
        if (!pathValue || seen[pathValue]) return;
        seen[pathValue] = true;
        normalized.push({
            name: String(file && file.name || '').trim() || pathValue.split('/').pop() || pathValue,
            path: pathValue,
        });
    });
    return normalized;
}

export function getSkillFallbackText(skills) {
    return '使用技能：' + skills.map(function (skill) { return skill.name; }).join('、');
}

export function getProjectFallbackText(projects) {
    return '涉及项目：' + projects.map(function (project) { return project.name; }).join('、');
}

export function getFileReferenceFallbackText(files) {
    return '引用文件：' + files.map(function (file) { return file.path || file.name; }).join('、');
}

export function getSelectionFallbackText(skills, projects, files) {
    var parts = [];
    if (skills && skills.length > 0) parts.push(getSkillFallbackText(skills));
    if (projects && projects.length > 0) parts.push(getProjectFallbackText(projects));
    if (files && files.length > 0) parts.push(getFileReferenceFallbackText(files));
    return parts.join('\n');
}

export function isSelectionOnlyFallback(text, skills, projects, files) {
    skills = skills || [];
    projects = projects || [];
    files = files || [];
    if (skills.length === 0 && projects.length === 0 && files.length === 0) return false;
    var value = String(text || '').trim();
    if (!value) return false;
    var names = skills.map(function (skill) { return skill.name; }).join('、');
    var projectNames = projects.map(function (project) { return project.name; }).join('、');
    var filePaths = files.map(function (file) { return file.path || file.name; }).join('、');
    return value === getSelectionFallbackText(skills, projects, files) ||
        (skills.length > 0 && projects.length === 0 && files.length === 0 && (
            value === getSkillFallbackText(skills) ||
            value === ('使用技能:' + names) ||
            value === ('本轮请使用这些技能：' + names)
        )) ||
        (projects.length > 0 && skills.length === 0 && files.length === 0 && value === getProjectFallbackText(projects)) ||
        (projects.length > 0 && files.length === 0 && value === ('本轮涉及项目：' + projectNames)) ||
        (files.length > 0 && skills.length === 0 && projects.length === 0 && (
            value === getFileReferenceFallbackText(files) ||
            value === ('本轮引用文件：' + filePaths)
        ));
}

export function createMessageSkillRefs(skills) {
    var wrap = document.createElement('span');
    wrap.className = 'message-skills';
    skills.forEach(function (skill) {
        var item = document.createElement('span');
        item.className = 'message-skill-ref';
        item.title = '本轮使用技能';
        item.innerHTML =
            getSkillIconHtml('message-skill-icon') +
            '<span class="message-skill-name">' + escapeHtml(skill.name) + '</span>';
        wrap.appendChild(item);
    });
    return wrap;
}

export function createMessageProjectRefs(projects) {
    var wrap = document.createElement('span');
    wrap.className = 'message-skills';
    projects.forEach(function (project) {
        var item = document.createElement('span');
        item.className = 'message-skill-ref project-ref';
        item.title = project.path ? ('本轮涉及项目: ' + project.path) : '本轮涉及项目';
        item.innerHTML =
            getProjectIconHtml('message-skill-icon') +
            '<span class="message-skill-name">' + escapeHtml(project.name) + '</span>';
        wrap.appendChild(item);
    });
    return wrap;
}

export function createMessageFileRefs(files) {
    var wrap = document.createElement('span');
    wrap.className = 'message-skills';
    files.forEach(function (file) {
        var item = document.createElement('span');
        item.className = 'message-skill-ref file-ref';
        item.title = file.path ? ('本轮引用文件: ' + file.path) : '本轮引用文件';
        item.innerHTML =
            getFileIconHtml('message-skill-icon') +
            '<span class="message-skill-name">' + escapeHtml(file.name || file.path) + '</span>';
        wrap.appendChild(item);
    });
    return wrap;
}
