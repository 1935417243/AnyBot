// 推理强度档位（顺序即滑块从左到右「快速 → 深度」）；按 provider 区分：
// claude-code 有 6 档（ultracode 是 UI 档，后端会映射为 xhigh 传给 SDK），codex 与 CLI 选择器一致共 4 档
var EFFORT_LEVELS_BY_PROVIDER = {
    'claude-code': [
        { id: 'low', name: 'Low' },
        { id: 'medium', name: 'Medium' },
        { id: 'high', name: 'High' },
        { id: 'xhigh', name: 'XHigh' },
        { id: 'max', name: 'Max' },
        { id: 'ultracode', name: 'Ultracode' },
    ],
    'codex': [
        { id: 'low', name: 'Low' },
        { id: 'medium', name: 'Medium' },
        { id: 'high', name: 'High' },
        { id: 'xhigh', name: 'XHigh' },
    ],
};

// 未持久化过时前端展示的默认档位（各 provider 的档位列表里都包含它）
var DEFAULT_EFFORT = 'high';

// 刻度/滑块距容器两侧的内边距（px）= 轨道内边距（chat.css 中 .effort-slider-track 的 left/right，8px）+ 滑块半宽（6px），
// 使滑块滑到两端时外缘与轨道端部齐平，填充圆弧与滑块圆角无缝接续
var SLIDER_PADDING_PX = 14;

export function createEffortMode(options) {
    var switcher = options.switcher;
    var badge = options.badge;
    var nameEl = options.nameEl;
    var dropdown = options.dropdown;
    // 当前选中档位 id
    var currentEffort = DEFAULT_EFFORT;
    // 当前 provider 类型；null 表示该 provider 不支持强度档位，选择器隐藏
    var providerType = null;
    // 拖动滑块时预览的档位索引，null 表示不在拖动中
    var dragIndex = null;

    var titleEl = null;
    var sliderEl = null;
    var fillEl = null;
    var thumbEl = null;
    var stopEls = [];

    // 当前 provider 的档位列表；不支持的 provider 返回空数组
    function currentLevels() {
        return (providerType && EFFORT_LEVELS_BY_PROVIDER[providerType]) || [];
    }

    function findLevel(id) {
        var levels = currentLevels();
        for (var i = 0; i < levels.length; i++) {
            if (levels[i].id === id) return levels[i];
        }
        return null;
    }

    function levelIndex(id) {
        var levels = currentLevels();
        for (var i = 0; i < levels.length; i++) {
            if (levels[i].id === id) return i;
        }
        // 档位不在当前 provider 列表里时回落到默认档（两个列表都包含 high，不会死循环）
        return id === DEFAULT_EFFORT ? 0 : levelIndex(DEFAULT_EFFORT);
    }

    function setOpen(isOpen) {
        if (!switcher || !badge) return;
        switcher.classList.toggle('open', isOpen);
        badge.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }

    // 档位索引对应的滑块横向位置（避开两侧内边距，端点与轨道两端对齐）
    function positionForRatio(ratio) {
        return 'calc(' + SLIDER_PADDING_PX + 'px + (100% - ' + SLIDER_PADDING_PX * 2 + 'px) * ' + ratio + ')';
    }

    // 根据档位索引刷新滑块视觉（进度填充、刻度、滑块位置、标题）
    function updateSliderVisual(previewIndex) {
        if (!sliderEl) return;
        var levels = currentLevels();
        if (!levels.length) return;
        var activeIndex = previewIndex != null ? previewIndex : levelIndex(currentEffort);
        var ratio = activeIndex / (levels.length - 1);
        fillEl.style.width = (ratio * 100) + '%';
        thumbEl.style.left = positionForRatio(ratio);
        stopEls.forEach(function (stop, index) {
            stop.classList.toggle('filled', index <= activeIndex);
        });
        sliderEl.classList.toggle('dragging', previewIndex != null);
        if (titleEl) titleEl.textContent = '强度 ' + levels[activeIndex].name;
    }

    function render() {
        var level = findLevel(currentEffort) || findLevel(DEFAULT_EFFORT) || { name: '' };
        if (nameEl) nameEl.textContent = level.name;
        if (badge) badge.title = '强度：' + level.name;
        // 不支持的 provider 直接 display:none 移除占位，避免留下一块空白区域
        if (switcher) switcher.style.display = providerType ? '' : 'none';
        updateSliderVisual(null);
    }

    // 弹层 DOM 在初始化及 provider 切换（档位数变化）时构建；拖动过程中不重建，只走 updateSliderVisual
    function buildDropdown() {
        if (!dropdown) return;
        dropdown.innerHTML = '';

        titleEl = document.createElement('div');
        titleEl.className = 'effort-dropdown-title';
        dropdown.appendChild(titleEl);

        var labels = document.createElement('div');
        labels.className = 'effort-slider-labels';
        labels.innerHTML = '<span>快速</span><span>深度</span>';
        dropdown.appendChild(labels);

        sliderEl = document.createElement('div');
        sliderEl.className = 'effort-slider';

        var track = document.createElement('div');
        track.className = 'effort-slider-track';
        fillEl = document.createElement('div');
        fillEl.className = 'effort-slider-fill';
        track.appendChild(fillEl);
        sliderEl.appendChild(track);

        var levels = currentLevels();
        stopEls = levels.map(function (level, index) {
            var stop = document.createElement('span');
            stop.className = 'effort-slider-stop';
            stop.style.left = positionForRatio(index / (levels.length - 1));
            sliderEl.appendChild(stop);
            return stop;
        });

        thumbEl = document.createElement('div');
        thumbEl.className = 'effort-slider-thumb';
        sliderEl.appendChild(thumbEl);

        sliderEl.addEventListener('pointerdown', handlePointerDown);
        dropdown.appendChild(sliderEl);
    }

    // 把指针横坐标换算成最近的档位索引（扣除两侧内边距）
    function indexFromEvent(e) {
        var levels = currentLevels();
        var rect = sliderEl.getBoundingClientRect();
        var usable = rect.width - SLIDER_PADDING_PX * 2;
        if (usable <= 0 || !levels.length) return levelIndex(currentEffort);
        var ratio = (e.clientX - rect.left - SLIDER_PADDING_PX) / usable;
        ratio = Math.max(0, Math.min(1, ratio));
        return Math.round(ratio * (levels.length - 1));
    }

    function handlePointerDown(e) {
        e.stopPropagation();
        e.preventDefault();
        if (sliderEl.setPointerCapture) sliderEl.setPointerCapture(e.pointerId);
        dragIndex = indexFromEvent(e);
        updateSliderVisual(dragIndex);
        sliderEl.addEventListener('pointermove', handlePointerMove);
        sliderEl.addEventListener('pointerup', handlePointerUp);
        sliderEl.addEventListener('pointercancel', handlePointerCancel);
    }

    function handlePointerMove(e) {
        e.stopPropagation();
        dragIndex = indexFromEvent(e);
        updateSliderVisual(dragIndex);
    }

    function handlePointerUp(e) {
        e.stopPropagation();
        var selectedIndex = dragIndex;
        cleanupDrag();
        var levels = currentLevels();
        if (selectedIndex != null && levels[selectedIndex]) selectEffort(levels[selectedIndex].id);
    }

    function handlePointerCancel() {
        cleanupDrag();
        updateSliderVisual(null);
    }

    function cleanupDrag() {
        dragIndex = null;
        sliderEl.removeEventListener('pointermove', handlePointerMove);
        sliderEl.removeEventListener('pointerup', handlePointerUp);
        sliderEl.removeEventListener('pointercancel', handlePointerCancel);
    }

    async function fetchConfig() {
        try {
            var res = await fetch('/api/model-config');
            if (!res.ok) return;
            var data = await res.json();
            applyModelConfig(data);
        } catch (e) {
            console.error('Failed to fetch effort config:', e);
        }
    }

    // 同步模型配置中的 provider 与 effort：切换 provider 时控制显隐并重建滑块档位，恢复已持久化的档位
    function applyModelConfig(data) {
        if (!data) return;
        var nextProviderType = EFFORT_LEVELS_BY_PROVIDER[data.provider] ? data.provider : null;
        if (nextProviderType !== providerType) {
            providerType = nextProviderType;
            // 档位数可能变化（如 claude-code 6 档 ↔ codex 4 档），关闭弹层并重建滑块
            setOpen(false);
            buildDropdown();
        }
        // 持久化档位可能超出当前 provider 的支持范围（如 codex 没有 max/ultracode），回落到默认档
        if (findLevel(data.effort)) {
            currentEffort = data.effort;
        } else if (!findLevel(currentEffort)) {
            currentEffort = DEFAULT_EFFORT;
        }
        render();
    }

    async function selectEffort(id) {
        if (!findLevel(id)) return;
        // 切换档位后保持弹层打开，方便连续调整；点击外部 / Esc / 再次点 badge 才关闭
        if (id === currentEffort) {
            updateSliderVisual(null);
            return;
        }
        try {
            var res = await fetch('/api/model-config', {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({effort: id}),
            });
            if (!res.ok) {
                var err = await res.json().catch(function () { return {}; });
                if (options.onError) options.onError(err.error || '保存强度配置失败');
                updateSliderVisual(null);
                return;
            }
            currentEffort = id;
            render();
            if (options.onChanged) options.onChanged(currentEffort);
        } catch (e) {
            if (options.onError) options.onError('保存强度配置失败');
            updateSliderVisual(null);
        }
    }

    if (badge) {
        badge.addEventListener('click', function (e) {
            e.stopPropagation();
            var willOpen = !(switcher && switcher.classList.contains('open'));
            setOpen(willOpen);
            // 打开时通知外部关闭其他弹层（如模型下拉），避免两个弹层重叠
            if (willOpen && options.onOpen) options.onOpen();
        });
    }

    buildDropdown();
    render();

    return {
        handleDocumentClick: function (e) {
            if (switcher && !switcher.contains(e.target)) setOpen(false);
        },
        handleEscape: function () {
            if (switcher && switcher.classList.contains('open')) {
                setOpen(false);
                if (badge) badge.focus();
                return true;
            }
            return false;
        },
        // 主动关闭弹层（供其他弹层打开时互斥调用）
        close: function () {
            setOpen(false);
        },
        refresh: fetchConfig,
        applyModelConfig: applyModelConfig,
        // 发消息时透传给后端的档位；当前 provider 不支持强度档位时不携带
        getEffort: function () {
            return providerType ? currentEffort : null;
        },
    };
}
