// 通用危险操作确认弹窗，风格与侧边栏“删除项目”确认框保持一致。
export function showConfirmDialog(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
        var existing = document.getElementById('app-confirm-overlay');
        if (existing) existing.remove();

        var overlay = document.createElement('div');
        overlay.className = 'app-confirm-overlay';
        overlay.id = 'app-confirm-overlay';

        var dialog = document.createElement('div');
        dialog.className = 'app-confirm-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'app-confirm-title');

        var header = document.createElement('div');
        header.className = 'app-confirm-header';

        var icon = document.createElement('div');
        icon.className = 'app-confirm-icon';
        icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M9 6.6v3.6M9 12.6h.01M3.4 14.4h11.2L9 3.6 3.4 14.4Z" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/></svg>';

        var title = document.createElement('div');
        title.className = 'app-confirm-title';
        title.id = 'app-confirm-title';
        title.textContent = opts.title || '确认操作';

        header.appendChild(icon);
        header.appendChild(title);

        var message = document.createElement('p');
        message.className = 'app-confirm-message';
        message.textContent = opts.message || '';

        var actions = document.createElement('div');
        actions.className = 'app-confirm-actions';

        var cancelBtn = document.createElement('button');
        cancelBtn.className = 'app-confirm-cancel';
        cancelBtn.type = 'button';
        cancelBtn.textContent = opts.cancelText || '取消';

        var confirmBtn = document.createElement('button');
        confirmBtn.className = 'app-confirm-danger';
        confirmBtn.type = 'button';
        confirmBtn.textContent = opts.confirmText || '确认';

        actions.appendChild(cancelBtn);
        actions.appendChild(confirmBtn);

        dialog.appendChild(header);
        dialog.appendChild(message);
        dialog.appendChild(actions);
        overlay.appendChild(dialog);

        var closed = false;
        function close(result) {
            if (closed) return;
            closed = true;
            document.removeEventListener('keydown', onKeydown);
            overlay.classList.remove('open');
            setTimeout(function () {
                overlay.remove();
            }, 160);
            resolve(result);
        }

        function onKeydown(e) {
            if (e.key === 'Escape') close(false);
        }

        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) close(false);
        });
        cancelBtn.addEventListener('click', function () {
            close(false);
        });
        confirmBtn.addEventListener('click', function () {
            close(true);
        });
        document.addEventListener('keydown', onKeydown);
        document.body.appendChild(overlay);
        requestAnimationFrame(function () {
            overlay.classList.add('open');
        });
        setTimeout(function () {
            cancelBtn.focus();
        }, 0);
    });
}
