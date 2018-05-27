let preventedDuplicatesCount = 0;
let active = true;

chrome.browserAction.setBadgeBackgroundColor({
    color: '#933EC5'
});

chrome.browserAction.onClicked.addListener(tab => {
    active = !active;
    updateBadge();
});

chrome.tabs.onCreated.addListener(newTab => {
    if (active && newTab.url) {
        verifyAndDeduplicate(newTab.id, newTab.url);
    }
});

chrome.tabs.onUpdated.addListener((updatedTabId, updateInfo, updatedTab) => {
    if (active && updateInfo.url) {
        verifyAndDeduplicate(updatedTabId, updateInfo.url);
    }
});

function verifyAndDeduplicate(currentTabId, currentTabUrl) {
    chrome.tabs.query({}, tabs => {
        var duplicateTab = null;
        tabs.forEach(otherTab => {
            if (otherTab.id !== currentTabId && otherTab.url === currentTabUrl) {
                duplicateTab = otherTab;
            }
        });
        if (duplicateTab) {
            chrome.tabs.update(duplicateTab.id, {
                "active": true
            });
            chrome.windows.update(duplicateTab.windowId, {
                focused: true
            })
            chrome.tabs.remove(currentTabId);
            preventedDuplicatesCount++;
            updateBadge();
        }
    });
}

function updateBadge() {
    chrome.browserAction.setBadgeText({
        text: active ? (preventedDuplicatesCount > 0 ? `${preventedDuplicatesCount}` : '') : 'OFF'
    });
}