let preventedDuplicatesCount = 0;
let active = true;
let stateLoaded = false;

// Tabs this extension is closing right now, so their own events are ignored.
const tabsBeingHandled = new Set();

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

// New tab pages are never treated as duplicates, so opening several of them works.
const NEW_TAB_URLS = new Set([
    'about:blank',
    'about:newtab',
    'chrome://newtab/',
    'chrome://new-tab-page/',
]);

function isNewTabPage(url) {
    return NEW_TAB_URLS.has(url);
}

chrome.action.setBadgeBackgroundColor({ color: '#933EC5' });

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'SetActive') {
        void stateReady.then(() => {
            active = Boolean(request.active);
            persistState();
            sendResponse({ active, preventedDuplicatesCount });
        });
        return true;
    }
    if (request.action === 'Deduplicate') {
        void stateReady
            .then(() => deduplicateExistingTabs())
            .then(result => sendResponse({ ...result, preventedDuplicatesCount }));
        return true;
    }
    if (request.action === 'GetState') {
        void stateReady.then(() => sendResponse({ active, preventedDuplicatesCount }));
        return true;
    }
    return false;
});

chrome.tabs.onCreated.addListener(newTab => {
    if (!stateLoaded || !active || newTab.id === undefined || !newTab.url) {
        return;
    }
    void verifyAndDeduplicate(newTab.id, newTab.url);
});

chrome.tabs.onUpdated.addListener((updatedTabId, updateInfo) => {
    if (!stateLoaded || !active || !updateInfo.url) {
        return;
    }
    void verifyAndDeduplicate(updatedTabId, updateInfo.url);
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

async function deduplicateExistingTabs() {
    const tabs = (await chrome.tabs.query({})).sort(byAge);
    const alreadyEncounteredUrls = new Set();
    const toClose = [];
    for (const tab of tabs) {
        if (!tab.url || tab.id === undefined || isNewTabPage(tab.url)) continue;
        const key = normalizeUrl(tab.url);
        if (alreadyEncounteredUrls.has(key)) {
            toClose.push(tab.id);
        } else {
            alreadyEncounteredUrls.add(key);
        }
    }
    if (toClose.length > 0) {
        toClose.forEach(id => tabsBeingHandled.add(id));
        try {
            await chrome.tabs.remove(toClose);
        } finally {
            toClose.forEach(id => tabsBeingHandled.delete(id));
        }
        preventedDuplicatesCount += toClose.length;
        persistState();
    }
    return { scanned: tabs.length, closed: toClose.length };
}

async function verifyAndDeduplicate(currentTabId, currentTabUrl) {
    if (tabsBeingHandled.has(currentTabId) || isNewTabPage(currentTabUrl)) return;
    const key = normalizeUrl(currentTabUrl);
    const tabs = await chrome.tabs.query({});
    const oldest = tabs
        .filter(t => t.id !== undefined && t.id !== currentTabId && t.url && normalizeUrl(t.url) === key)
        .sort(byAge)[0];
    if (!oldest) return;

    tabsBeingHandled.add(currentTabId);
    try {
        await chrome.tabs.update(oldest.id, { active: true });
        if (oldest.windowId !== undefined) {
            await chrome.windows.update(oldest.windowId, { focused: true });
        }
        await chrome.tabs.remove(currentTabId);
    } catch (e) {
        console.warn('Prevent Duplicate Tabs: could not switch tabs', e);
        return;
    } finally {
        tabsBeingHandled.delete(currentTabId);
    }
    preventedDuplicatesCount++;
    persistState();
}

function persistState() {
    chrome.storage.local.set({
        active,
        preventedDuplicatesCount,
    });
    updateBadge();
}

function updateBadge() {
    let text = '';
    if (active) {
        // Chrome truncates badge text to ~4 characters.
        text = preventedDuplicatesCount >= 1000 ? '999+' : `${preventedDuplicatesCount}`;
    } else {
        text = 'OFF';
    }
    chrome.action.setBadgeText({ text });
}
