const DEFAULT_TOAST_DURATION_MS = 4000;

export function createToastController(options) {
    options = options || {};

    const documentRef = options.documentRef || (typeof document !== 'undefined' ? document : null);
    const defaultDurationMs = options.durationMs || DEFAULT_TOAST_DURATION_MS;

    function showToast(message, toastOptions) {
        toastOptions = toastOptions || {};
        if (!documentRef || !documentRef.body) return null;

        var toast = documentRef.createElement('div');
        toast.className = toastOptions.className || 'error-toast';
        toast.textContent = message || '';
        toast.setAttribute('role', toastOptions.role || 'alert');
        toast.setAttribute('aria-live', toastOptions.ariaLive || 'assertive');
        documentRef.body.appendChild(toast);

        var durationMs = toastOptions.durationMs || defaultDurationMs;
        var timer = setTimeout(function () {
            toast.remove();
        }, durationMs);

        return {
            dismiss: function () {
                clearTimeout(timer);
                toast.remove();
            },
            element: toast,
        };
    }

    function showError(message) {
        return showToast(message, {
            className: 'error-toast',
            role: 'alert',
            ariaLive: 'assertive',
        });
    }

    return {
        showError: showError,
        showToast: showToast,
    };
}
