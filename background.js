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

// Builds the key used to decide whether two URLs are duplicates:
// - the #fragment is ignored (`page#a` and `page#b` are the same page);
// - `https://example.com` and `https://example.com/` are the same;
// - every view of a GitHub pull request (`/files`, `/commits`, `/checks`,
//   `#discussion_r...`, ...) collapses to `https://github.com/<owner>/<repo>/pull/<id>`.
// Query strings are kept, so different searches stay different tabs.
function normalizeUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return url;
    }
    parsed.hash = '';

    if (parsed.hostname === 'github.com') {
        const pr = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/);
        if (pr) {
            return `https://github.com/${pr[1]}/${pr[2]}/pull/${pr[3]}`;
        }
    }

    return parsed.toString();
}

// Tab ids grow over a browser session, so the smallest id is the oldest tab.
function byAge(a, b) {
    return a.id - b.id;
}

function deduplicateExistingTabs() {
    chrome.tabs.query({}, tabs => {
        const alreadyEncounteredTabUrls = new Set();
        tabs.sort(byAge).forEach(tab => {
            if (!tab.url || tab.id === undefined) return;
            const key = normalizeUrl(tab.url);
            if (alreadyEncounteredTabUrls.has(key)) {
                chrome.tabs.remove(tab.id);
                preventedDuplicatesCount++;
            }
            alreadyEncounteredTabUrls.add(key);
        });
        persistState();
    });
}

function verifyAndDeduplicate(currentTabId, currentTabUrl) {
    chrome.tabs.query({}, tabs => {
        const key = normalizeUrl(currentTabUrl);
        const duplicate = tabs
            .filter(t => t.id !== undefined && t.id !== currentTabId && t.url && normalizeUrl(t.url) === key)
            .sort(byAge)[0];
        if (!duplicate || duplicate.id === undefined) return;

        chrome.tabs.update(duplicate.id, { active: true });
        if (duplicate.windowId !== undefined) {
            chrome.windows.update(duplicate.windowId, { focused: true });
        }
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
