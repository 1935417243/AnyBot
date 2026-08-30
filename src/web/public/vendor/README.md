# Third-party Browser Assets

These files are vendored so the packaged desktop client can render the Web UI without loading CDN assets at startup.

- `marked/marked.umd.js`: marked 12.0.2
- `dompurify/purify.min.js`: DOMPurify 3.4.6
- `highlight/highlight.min.js`: highlight.js 11.9.0
- `highlight/github-dark-dimmed.min.css`: highlight.js GitHub Dark Dimmed theme 11.9.0
- `highlight/github.min.css`: highlight.js GitHub light theme 11.9.0
- `mermaid/mermaid.min.js`: mermaid 11.17.2（按需懒加载，仅 ```mermaid 代码块使用时加载）

License files are stored next to each vendored package.
