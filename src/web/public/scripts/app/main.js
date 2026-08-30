import { createAnyBotApp } from './app/create-app.js';
import { getAppDom } from './app/dom.js';
import { enhanceLocalFileLinks } from './chat/local-file-links.js';
import { createTaskDock } from './chat/task-dock.js';
import { initSidebarToggle } from './sidebar/sidebar-toggle.js';
import { renderMarkdown, configureMarkdown } from './markdown.js';
import { enhanceCodeBlocks } from './chat/code-block-preview.js';

configureMarkdown();
window.AnyBotMarkdown = { render: renderMarkdown };
window.AnyBotLocalFiles = { enhance: enhanceLocalFileLinks };
window.AnyBotCodePreview = { enhance: enhanceCodeBlocks };
window.TaskDock = createTaskDock({ inputArea: document.getElementById('input-area') });
initSidebarToggle(document.getElementById('sidebar-toggle'));

const dom = getAppDom(document);
const app = createAnyBotApp(dom, {
    documentRef: document,
    renderMarkdown: renderMarkdown,
});

app.init();
