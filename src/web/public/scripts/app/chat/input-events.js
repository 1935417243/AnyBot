export function bindChatInputEvents(config) {
    bindInputWrapper(config);
    bindTextInput(config);
    bindSendButton(config);
    bindAttachmentButton(config);
    bindPasteUpload(config);
    bindDropUpload(config);
}

function bindInputWrapper(config) {
    if (!config.inputWrapper) return;
    config.inputWrapper.addEventListener('click', function (event) {
        if (event.target === config.inputEl) return;
        if (event.target.closest && event.target.closest('button, input, textarea, [tabindex], .model-switcher')) return;
        focusInputEnd(config.inputEl);
    });
}

function bindTextInput(config) {
    config.inputEl.addEventListener('input', function () {
        config.resetInputHistoryNavigation();
        if (config.inputEl.value.length > 0) config.clearPromptSkillDeleteTarget();
        config.resizeChatInput();
        config.updateSendBtnState();
        config.syncSkillPickerFromInput();
    });

    config.inputEl.addEventListener('keydown', function (event) {
        if (config.handleSkillPickerKeydown(event)) return;
        if (config.handlePromptSkillBackspace(event)) return;
        if (event.key === '/' && config.canOpenSkillPickerFromSlash(event)) {
            event.preventDefault();
            config.insertSkillSlashTrigger();
            return;
        }
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            var direction = event.key === 'ArrowUp' ? -1 : 1;
            if (config.shouldHandleInputHistoryKey(event, direction)) {
                event.preventDefault();
                config.navigateInputHistory(direction);
                return;
            }
        }
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            if (!config.getIsTyping() && !config.sendBtn.disabled) config.sendMessage();
        }
    });
}

function bindSendButton(config) {
    config.sendBtn.addEventListener('click', function () {
        if (config.getIsTyping()) {
            config.cancelCurrentResponse();
            return;
        }
        config.sendMessage();
    });
}

function bindAttachmentButton(config) {
    config.attachBtn.addEventListener('click', function () {
        config.fileInput.click();
    });

    config.fileInput.addEventListener('change', function (event) {
        var input = event.currentTarget;
        if (input.files && input.files.length > 0) {
            config.uploadFiles(input.files);
        }
        input.value = '';
    });
}

function bindPasteUpload(config) {
    config.inputEl.addEventListener('paste', function (event) {
        var items = event.clipboardData && event.clipboardData.items;
        if (!items) return;
        var files = [];
        for (var i = 0; i < items.length; i++) {
            if (items[i].kind === 'file') {
                var file = items[i].getAsFile();
                if (file) files.push(file);
            }
        }
        if (files.length > 0) {
            event.preventDefault();
            config.uploadFiles(files);
        }
    });
}

function bindDropUpload(config) {
    var dragCounter = 0;

    config.chatViewEl.addEventListener('dragenter', function (event) {
        event.preventDefault();
        dragCounter++;
        config.dropOverlay.style.display = 'flex';
    });

    config.chatViewEl.addEventListener('dragleave', function (event) {
        event.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            config.dropOverlay.style.display = 'none';
        }
    });

    config.chatViewEl.addEventListener('dragover', function (event) {
        event.preventDefault();
    });

    config.chatViewEl.addEventListener('drop', function (event) {
        event.preventDefault();
        dragCounter = 0;
        config.dropOverlay.style.display = 'none';
        if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length > 0) {
            config.uploadFiles(event.dataTransfer.files);
        }
    });
}

function focusInputEnd(inputEl) {
    inputEl.focus();
    var end = inputEl.value.length;
    if (inputEl.setSelectionRange) inputEl.setSelectionRange(end, end);
}
