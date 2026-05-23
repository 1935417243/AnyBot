export function openImageModal(src) {
    var overlay = document.createElement('div');
    overlay.className = 'image-modal-overlay';

    var img = document.createElement('img');
    img.className = 'image-modal-img';
    img.src = src;

    overlay.appendChild(img);
    document.body.appendChild(overlay);

    requestAnimationFrame(function () {
        overlay.classList.add('active');
    });

    overlay.addEventListener('click', function (event) {
        if (event.target === overlay) {
            closeImageModal(overlay);
        }
    });

    document.addEventListener('keydown', function handleKeydown(event) {
        if (event.key === 'Escape') {
            closeImageModal(overlay);
            document.removeEventListener('keydown', handleKeydown);
        }
    });
}

function closeImageModal(overlay) {
    overlay.classList.remove('active');
    setTimeout(function () {
        overlay.remove();
    }, 200);
}
