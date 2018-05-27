chrome.tabs.onCreated.addListener(newTab => {
    if (newTab.url) {
        verifyAndDeduplicate(newTab.id, newTab.url);
    }
});

chrome.tabs.onUpdated.addListener((updatedTabId, updateInfo, updatedTab) => {
    if (updateInfo.url) {
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
        }
    });
}