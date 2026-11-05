// 判断当前是否运行在 macOS（Electron 桌面端或浏览器），用于选择 ⌘ 或 Ctrl/Alt 快捷键
export function isMacPlatform(documentRef) {
    var doc = documentRef || document;
    if (doc.body && doc.body.classList.contains('platform-macos-desktop')) return true;
    var platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    return /mac/i.test(platform);
}
