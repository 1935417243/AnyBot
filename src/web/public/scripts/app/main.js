import { createAnyBotApp } from './app/create-app.js';
import { getAppDom } from './app/dom.js';
import { renderMarkdown, configureMarkdown } from './markdown.js';

configureMarkdown();
window.AnyBotMarkdown = { render: renderMarkdown };

const dom = getAppDom(document);
const app = createAnyBotApp(dom, {
    documentRef: document,
    renderMarkdown: renderMarkdown,
});

app.init();
