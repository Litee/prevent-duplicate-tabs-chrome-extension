let preventedDuplicatesCount = 0;
let active = true;
let stateLoaded = false;

// MV3 service workers can be terminated and restarted at any time, so the
// on/off switch and counter are persisted in chrome.storage.local. All state
// mutations wait for `stateReady` so a write never lands before the persisted
// values have been loaded (which would overwrite them with stale defaults).
const stateReady = new Promise(resolve => {
    chrome.storage.local.get(['active', 'preventedDuplicatesCount'], stored => {
        active = stored.active ?? true;
        preventedDuplicatesCount = stored.preventedDuplicatesCount ?? 0;
        stateLoaded = true;
        updateBadge();
        resolve();
    });
});

chrome.action.setBadgeBackgroundColor({ color: '#933EC5' });

chrome.runtime.onMessage.addListener((request, _sender, _sendResponse) => {
    if (request.action === 'TurnOnOff') {
        void stateReady.then(() => {
            active = !active;
            persistState();
        });
    }
    else if (request.action === 'Deduplicate') {
        void stateReady.then(() => {
            deduplicateExistingTabs();
        });
    }
});

chrome.tabs.onCreated.addListener(newTab => {
    if (!stateLoaded || !active || newTab.id === undefined || !newTab.url) {
        return;
    }
    verifyAndDeduplicate(newTab.id, newTab.url);
});

chrome.tabs.onUpdated.addListener((updatedTabId, updateInfo) => {
    if (!stateLoaded || !active || !updateInfo.url) {
        return;
    }
    verifyAndDeduplicate(updatedTabId, updateInfo.url);
});

function deduplicateExistingTabs() {
    chrome.tabs.query({}, tabs => {
        const alreadyEncounteredTabUrls = new Set();
        tabs.forEach(tab => {
            if (!tab.url || tab.id === undefined) return;
            if (alreadyEncounteredTabUrls.has(tab.url)) {
                chrome.tabs.remove(tab.id);
                preventedDuplicatesCount++;
            }
            alreadyEncounteredTabUrls.add(tab.url);
        });
        persistState();
    });
}

function verifyAndDeduplicate(currentTabId, currentTabUrl) {
    chrome.tabs.query({}, tabs => {
        const duplicates = tabs.filter(t => t.id !== currentTabId && t.url === currentTabUrl);
        // Keep the most recently existing tab, matching the original behavior.
        const duplicate = duplicates[duplicates.length - 1];
        if (!duplicate || duplicate.id === undefined) return;

        chrome.tabs.update(duplicate.id, { active: true });
        if (duplicate.windowId !== undefined) {
            chrome.windows.update(duplicate.windowId, { focused: true });
        }
        chrome.tabs.reload(duplicate.id);
        chrome.tabs.remove(currentTabId);
        preventedDuplicatesCount++;
        persistState();
    });
}

function persistState() {
    chrome.storage.local.set({
        active,
        preventedDuplicatesCount
    });
    updateBadge();
}

function updateBadge() {
    let text = '';
    if (active) {
        // Chrome truncates badge text to ~4 characters.
        text = preventedDuplicatesCount >= 1000 ? '999+' : `${preventedDuplicatesCount}`;
    }
    else {
        text = 'OFF';
    }
    chrome.action.setBadgeText({ text });
}
