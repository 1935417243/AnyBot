export function copyCode(button) {
    var code = button.closest('pre').querySelector('code');
    var text = code.textContent || code.innerText;

    navigator.clipboard.writeText(text).then(function () {
        button.textContent = '已复制';
        setTimeout(function () {
            button.textContent = '复制';
        }, 1500);
    });
}
