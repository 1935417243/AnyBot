import { createAnyBotApp } from './app/create-app.js';
import { getAppDom } from './app/dom.js';
import { enhanceLocalFileLinks } from './chat/local-file-links.js';
import { renderMarkdown, configureMarkdown } from './markdown.js';

configureMarkdown();
window.AnyBotMarkdown = { render: renderMarkdown };
window.AnyBotLocalFiles = { enhance: enhanceLocalFileLinks };

const dom = getAppDom(document);
const app = createAnyBotApp(dom, {
    documentRef: document,
    renderMarkdown: renderMarkdown,
});

app.init();
