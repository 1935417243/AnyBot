import { escapeHtml } from '../utils/html.js';

function getFileTypeClass(name) {
    var ext = (name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    if (['.doc', '.docx', '.txt', '.rtf'].includes(ext)) return 'file-type-doc';
    if (['.xls', '.xlsx', '.csv'].includes(ext)) return 'file-type-sheet';
    if (ext === '.pdf') return 'file-type-pdf';
    if (['.js', '.ts', '.py', '.java', '.go', '.rs', '.cpp', '.c', '.html', '.css', '.json', '.xml', '.yaml', '.yml', '.sh', '.sql'].includes(ext)) return 'file-type-code';
    return 'file-type-other';
}

function getFileExt(name) {
    var ext = (name.match(/\.[^.]+$/) || [''])[0].replace('.', '').toUpperCase();
    return ext.slice(0, 4) || 'FILE';
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export function createAttachmentController(config) {
    function renderPreview() {
        var pendingAttachments = config.getPendingAttachments();
        if (pendingAttachments.length === 0) {
            config.attachmentPreview.style.display = 'none';
            config.attachmentPreview.innerHTML = '';
            return;
        }
        config.attachmentPreview.style.display = 'flex';
        config.attachmentPreview.innerHTML = '';
        pendingAttachments.forEach(function (attachment, index) {
            config.attachmentPreview.appendChild(createAttachmentItem(attachment, index));
        });
    }

    function createAttachmentItem(attachment, index) {
        var item = document.createElement('div');
        item.className = 'attachment-item' + (attachment.uploading ? ' uploading' : '');

        if (attachment.isImage && attachment.localUrl) {
            var thumb = document.createElement('img');
            thumb.className = 'attachment-item-thumb';
            thumb.src = attachment.localUrl;
            thumb.alt = attachment.name;
            item.appendChild(thumb);
        } else {
            var icon = document.createElement('div');
            icon.className = 'attachment-item-icon ' + getFileTypeClass(attachment.name);
            icon.textContent = getFileExt(attachment.name);
            item.appendChild(icon);
        }

        var info = document.createElement('div');
        info.className = 'attachment-item-info';
        info.innerHTML = '<div class="attachment-item-name">' + escapeHtml(attachment.name) + '</div>' +
            '<div class="attachment-item-size">' + formatSize(attachment.size) + '</div>';
        item.appendChild(info);

        if (!attachment.uploading) {
            item.appendChild(createRemoveButton(index));
        }

        return item;
    }

    function createRemoveButton(index) {
        var removeBtn = document.createElement('button');
        removeBtn.className = 'attachment-item-remove';
        removeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
        removeBtn.addEventListener('click', function () {
            config.getPendingAttachments().splice(index, 1);
            renderPreview();
            config.updateSendBtnState();
        });
        return removeBtn;
    }

    async function uploadFile(file) {
        var isImage = config.imageExts.some(function (ext) {
            return file.name.toLowerCase().endsWith(ext);
        });
        var localUrl = isImage ? URL.createObjectURL(file) : null;
        var tempAttachment = { name: file.name, size: file.size, isImage: isImage, localUrl: localUrl, uploading: true, path: '' };
        config.getPendingAttachments().push(tempAttachment);
        renderPreview();
        config.updateSendBtnState();

        try {
            var formData = new FormData();
            formData.append('file', file);
            var res = await fetch('/api/upload', { method: 'POST', body: formData });
            if (!res.ok) throw new Error('上传失败');
            var data = await res.json();
            tempAttachment.path = data.path;
            tempAttachment.uploading = false;
            renderPreview();
            config.updateSendBtnState();
        } catch (e) {
            var index = config.getPendingAttachments().indexOf(tempAttachment);
            if (index !== -1) config.getPendingAttachments().splice(index, 1);
            renderPreview();
            config.updateSendBtnState();
            config.showError('文件上传失败: ' + (e.message || '未知错误'));
        }
    }

    async function uploadFiles(files) {
        for (var i = 0; i < files.length; i++) {
            await uploadFile(files[i]);
        }
    }

    return {
        renderPreview: renderPreview,
        uploadFiles: uploadFiles,
    };
}
