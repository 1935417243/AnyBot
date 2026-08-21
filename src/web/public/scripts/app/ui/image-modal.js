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

    function handleKeydown(event) {
        if (event.key === 'Escape') {
            closeImageModal(overlay, handleKeydown);
        }
    }

    document.addEventListener('keydown', handleKeydown);

    overlay.addEventListener('click', function (event) {
        if (event.target === overlay) {
            closeImageModal(overlay, handleKeydown);
        }
    });
}

function closeImageModal(overlay, handleKeydown) {
    document.removeEventListener('keydown', handleKeydown);
    overlay.classList.remove('active');
    setTimeout(function () {
        overlay.remove();
    }, 200);
}
