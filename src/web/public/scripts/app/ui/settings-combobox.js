import { escapeHtml } from '../utils/html.js';

export function buildSettingsComboboxOptionHtml(isActive, displayName, statusText) {
    return (
        isActive
            ? '<svg class="settings-combobox-check" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2.5 7.5l3 3 6-7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
            : '<span class="settings-combobox-check-placeholder"></span>'
    ) +
        '<span class="settings-combobox-option-label">' + escapeHtml(displayName || '') + '</span>' +
        (statusText ? '<span class="settings-combobox-option-status">' + escapeHtml(statusText) + '</span>' : '');
}

export function createSettingsSingleSelectCombobox(config) {
    var combobox = config.combobox;
    var trigger = config.trigger;
    var current = config.current;
    var menu = config.menu;
    var value = '';
    var items = [];

    function getEnabledOptions() {
        if (!menu) return [];
        return Array.prototype.slice.call(menu.querySelectorAll('.settings-combobox-option')).filter(function (item) {
            return !item.disabled;
        });
    }

    function setOpen(isOpen) {
        if (!combobox || !trigger) return;
        if (isOpen && config.closeOthers) config.closeOthers();
        combobox.classList.toggle('open', isOpen);
        trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        if (isOpen) {
            var active = menu && menu.querySelector('.settings-combobox-option.active:not(:disabled)');
            requestAnimationFrame(function () {
                (active || getEnabledOptions()[0] || trigger).focus();
            });
        }
    }

    function getSelectedItem() {
        return items.find(function (item) {
            return item.value === value;
        }) || null;
    }

    function renderDisplay() {
        var selected = getSelectedItem();
        if (current) current.textContent = selected ? selected.label : (config.placeholder || '请选择');
        if (!menu) return;
        Array.prototype.forEach.call(menu.querySelectorAll('.settings-combobox-option'), function (option) {
            var isActive = option.dataset.value === value;
            var isDisabled = option.dataset.disabled === 'true';
            option.classList.toggle('active', isActive);
            option.classList.toggle('disabled', isDisabled);
            option.disabled = isDisabled;
            option.setAttribute('aria-disabled', isDisabled ? 'true' : 'false');
            option.setAttribute('aria-selected', isActive ? 'true' : 'false');
            option.innerHTML = buildSettingsComboboxOptionHtml(isActive, option.dataset.label || '', option.dataset.status || '');
        });
    }

    function setValue(nextValue, options) {
        options = options || {};
        var nextItem = items.find(function (item) {
            return item.value === nextValue;
        });
        if (!nextItem || nextItem.disabled) return false;
        value = nextValue;
        renderDisplay();
        if (!options.silent && config.onChange) config.onChange(nextItem.value, nextItem);
        return true;
    }

    function moveFocus(delta) {
        var options = getEnabledOptions();
        if (!options.length) return;
        var currentIndex = options.indexOf(document.activeElement);
        var nextIndex = currentIndex < 0 ? 0 : (currentIndex + delta + options.length) % options.length;
        options[nextIndex].focus();
    }

    function handleOptionKeydown(e) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            moveFocus(1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            moveFocus(-1);
        } else if (e.key === 'Home') {
            e.preventDefault();
            var first = getEnabledOptions()[0];
            if (first) first.focus();
        } else if (e.key === 'End') {
            e.preventDefault();
            var options = getEnabledOptions();
            var last = options[options.length - 1];
            if (last) last.focus();
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.currentTarget.click();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
            if (trigger) trigger.focus();
        }
    }

    function render(nextItems, nextValue) {
        items = Array.isArray(nextItems) ? nextItems : [];
        value = nextValue || (items[0] && items[0].value) || '';
        if (menu) {
            menu.innerHTML = '';
            items.forEach(function (item) {
                var option = document.createElement('button');
                option.className = 'settings-combobox-option';
                option.type = 'button';
                option.setAttribute('role', 'option');
                option.dataset.value = item.value;
                option.dataset.label = item.label;
                option.dataset.status = item.status || '';
                option.dataset.disabled = item.disabled ? 'true' : 'false';
                option.disabled = !!item.disabled;
                option.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (setValue(item.value)) {
                        setOpen(false);
                        if (trigger) trigger.focus();
                    }
                });
                option.addEventListener('keydown', handleOptionKeydown);
                menu.appendChild(option);
            });
        }
        renderDisplay();
    }

    if (trigger) {
        trigger.addEventListener('click', function (e) {
            e.stopPropagation();
            if (trigger.disabled) return;
            setOpen(!combobox.classList.contains('open'));
        });
        trigger.addEventListener('keydown', function (e) {
            if (trigger.disabled) return;
            if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setOpen(true);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setOpen(true);
                requestAnimationFrame(function () {
                    var options = getEnabledOptions();
                    var last = options[options.length - 1];
                    if (last) last.focus();
                });
            } else if (e.key === 'Escape') {
                setOpen(false);
            }
        });
    }

    if (menu) {
        menu.addEventListener('click', function (e) {
            e.stopPropagation();
        });
    }

    return {
        render: render,
        setValue: setValue,
        setOpen: setOpen,
        contains: function (target) {
            return !!combobox && combobox.contains(target);
        },
        isOpen: function () {
            return !!combobox && combobox.classList.contains('open');
        },
        focusTrigger: function () {
            if (trigger) trigger.focus();
        },
        setDisabled: function (isDisabled) {
            if (trigger) trigger.disabled = !!isDisabled;
            if (combobox) combobox.classList.toggle('disabled', !!isDisabled);
        },
    };
}
