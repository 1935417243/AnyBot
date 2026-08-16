export function createViewRouter(options) {
    var currentView = options.initialView || 'chat';
    var documentRef = options.documentRef || document;

    function closeSkillPicker() {
        if (options.closeSkillPicker) options.closeSkillPicker();
    }

    function renderHistory() {
        if (options.renderHistory) options.renderHistory();
    }

    function renderProjects() {
        if (options.renderProjects) options.renderProjects();
    }

    function hideAllViews() {
        closeSkillPicker();
        options.chatView.style.display = 'none';
        options.channelView.style.display = 'none';
        options.skillsView.style.display = 'none';
        options.automationView.style.display = 'none';
        options.settingsView.style.display = 'none';
        options.settingsBtn.classList.remove('active');
    }

    function showChatView() {
        hideAllViews();
        currentView = 'chat';
        options.chatView.style.display = 'flex';
        renderHistory();
        renderProjects();
    }

    function showChannelsPage() {
        hideAllViews();
        currentView = 'channels';
        options.channelView.style.display = 'flex';
        renderHistory();
        if (options.renderChannelsPage) options.renderChannelsPage();
    }

    function showSkillsPage() {
        hideAllViews();
        currentView = 'skills';
        options.skillsView.style.display = 'flex';
        renderHistory();
        if (options.renderSkillsPage) options.renderSkillsPage();
    }

    function showAutomationsPage() {
        hideAllViews();
        currentView = 'automations';
        options.automationView.style.display = 'flex';
        renderHistory();
        if (options.renderAutomationsPage) options.renderAutomationsPage();
    }

    function showSettingsView() {
        hideAllViews();
        currentView = 'settings';
        options.settingsView.style.display = 'flex';
    }

    async function openChannelsPage() {
        if (options.fetchChannels) await options.fetchChannels();
        showChannelsPage();
    }

    async function openSkillsPage() {
        if (options.fetchSkills) await options.fetchSkills();
        showSkillsPage();
    }

    async function openAutomationsPage() {
        if (currentView === 'automations') return;
        if (!options.hasAutomationsData || !options.hasAutomationsData()) {
            if (options.fetchAutomations) await options.fetchAutomations();
        }
        showAutomationsPage();
    }

    function handleDocumentKeydown(e) {
        if (e.key === 'Escape' && options.handleAutomationsEscape && options.handleAutomationsEscape()) {
            return;
        }
        if (e.key === 'Escape' && options.handleChannelsEscape && options.handleChannelsEscape()) {
            return;
        }
        if (currentView !== 'skills') return;
        if (options.handleSkillsKeydown) options.handleSkillsKeydown(e);
    }

    function bindNavigation() {
        options.channelsBtn.addEventListener('click', function () {
            openChannelsPage();
        });
        options.skillsBtn.addEventListener('click', function () {
            openSkillsPage();
        });
        options.automationsBtn.addEventListener('click', function () {
            openAutomationsPage();
        });
        documentRef.addEventListener('keydown', handleDocumentKeydown);
    }

    function getCurrentView() {
        return currentView;
    }

    return {
        bindNavigation: bindNavigation,
        getCurrentView: getCurrentView,
        hideAllViews: hideAllViews,
        showChatView: showChatView,
        showChannelsPage: showChannelsPage,
        showAutomationsPage: showAutomationsPage,
        showSettingsView: showSettingsView,
        showSkillsPage: showSkillsPage,
    };
}
