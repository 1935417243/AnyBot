import { createSkillsPageController } from '../skills/skills-page.js';
import { showSkillsSaveStatus } from '../skills/skill-card.js';
import { createMcpController } from './mcp-controller.js';

export function createPluginsPageController(options) {
    var pluginsTabs = options.pluginsTabs || [];
    var pluginsTabPanels = options.pluginsTabPanels || [];
    var activeTab = 'skills';

    var skillsController = createSkillsPageController({
        skillsPanel: options.pluginsSkillsPanel,
        getActiveSlashProviderType: options.getActiveSlashProviderType,
        getProviderQuery: options.getProviderQuery,
        invalidateSlashItemsData: options.invalidateSlashItemsData,
        showError: options.showError,
    });

    var mcpController = createMcpController({
        mcpRefreshBtn: options.pluginsMcpRefreshBtn,
        mcpAddControl: options.pluginsMcpAddControl,
        mcpAddBtn: options.pluginsMcpAddBtn,
        mcpAddMenu: options.pluginsMcpAddMenu,
        mcpServerList: options.pluginsMcpServerList,
        showError: options.showError,
        showStatus: showSkillsSaveStatus,
    });

    function showChatView() {
        if (options.showChatView) options.showChatView();
    }

    function setTab(tab) {
        if (tab !== 'mcp') tab = 'skills';
        activeTab = tab;
        pluginsTabs.forEach(function (item) {
            var active = item.dataset.pluginsTab === tab;
            item.classList.toggle('active', active);
            item.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        pluginsTabPanels.forEach(function (panel) {
            panel.classList.toggle('active', panel.dataset.pluginsPanel === tab);
        });
        if (tab === 'mcp') {
            mcpController.activate();
        } else {
            mcpController.deactivate();
        }
    }

    pluginsTabs.forEach(function (item) {
        item.addEventListener('click', function () {
            setTab(item.dataset.pluginsTab || 'skills');
        });
    });

    if (options.pluginsCloseBtn) {
        options.pluginsCloseBtn.addEventListener('click', function () {
            showChatView();
        });
    }

    function fetchData() {
        return skillsController.fetchSkills();
    }

    function render() {
        skillsController.render();
    }

    function deactivate() {
        mcpController.deactivate();
    }

    function handleKeydown(e) {
        if (e.key === 'Escape') return mcpController.handleEscape();
        if (activeTab === 'skills') return skillsController.handleKeydown(e);
        return false;
    }

    function handleDocumentClick(e) {
        mcpController.handleDocumentClick(e);
    }

    return {
        deactivate: deactivate,
        fetchData: fetchData,
        handleDocumentClick: handleDocumentClick,
        handleKeydown: handleKeydown,
        render: render,
    };
}
