let preventedDuplicatesCount = 0;
let active = true;
let stateLoaded = false;

// Tabs this extension is closing right now, so their own events are ignored.
const tabsBeingHandled = new Set();

// Deduplication runs one tab at a time per normalized URL. Two tabs that arrive
// at the same URL in the same moment - ctrl-clicking a link twice, restoring a
// session, "open all bookmarks" - would otherwise each pick the other as the tab
// to keep and then close themselves, leaving no tab on that URL at all. Queueing
// instead of skipping means a third and fourth tab are still deduplicated, each
// against a freshly queried tab list.
const queueByKey = new Map();

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
    let pinnedKept = 0;
    for (const tab of tabs) {
        if (!tab.url || tab.id === undefined || isNewTabPage(tab.url)) continue;
        // Incognito tabs are only ever duplicates of other incognito tabs.
        const key = `${tab.incognito ? 'incognito' : 'normal'} ${normalizeUrl(tab.url)}`;
        if (alreadyEncounteredUrls.has(key)) {
            // Pinned tabs are never closed, even when they are duplicates.
            if (tab.pinned) {
                pinnedKept++;
            } else {
                toClose.push(tab.id);
            }
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
    return { scanned: tabs.length, closed: toClose.length, pinnedKept };
}

// Claims the tab and its URL, then queues the actual work behind anything else
// already running for that URL. The claims are taken synchronously, before the
// first await: onCreated and onUpdated both fire for a newly opened tab, so a
// claim taken after an await claims nothing.
function verifyAndDeduplicate(currentTabId, currentTabUrl) {
    if (tabsBeingHandled.has(currentTabId) || isNewTabPage(currentTabUrl)) return Promise.resolve();
    const key = normalizeUrl(currentTabUrl);
    tabsBeingHandled.add(currentTabId);
    const done = (queueByKey.get(key) ?? Promise.resolve())
        .then(() => switchToExistingTab(currentTabId, key))
        .finally(() => {
            tabsBeingHandled.delete(currentTabId);
            if (queueByKey.get(key) === done) {
                queueByKey.delete(key);
            }
        });
    queueByKey.set(key, done);
    return done;
}

// Closes the tab that just arrived at `key` and switches to the tab that was
// already showing it. The tab that was already there is the one kept, so its
// history, scroll position and unsaved input survive.
async function switchToExistingTab(currentTabId, key) {
    try {
        const tabs = await chrome.tabs.query({});
        const current = tabs.find(t => t.id === currentTabId);
        // The tab can be gone already - closed by the user, or by whatever was
        // queued ahead of this call.
        if (!current) return;
        // Incognito and normal windows are deduplicated separately - being pulled
        // across that boundary is never what the user asked for.
        const existing = tabs
            .filter(t => t.id !== undefined && t.id !== currentTabId && t.url
                && t.incognito === current.incognito
                && normalizeUrl(t.url) === key)
            .sort(byAge)[0];
        if (!existing) return;

        await chrome.tabs.update(existing.id, { active: true });
        if (existing.windowId !== undefined) {
            await chrome.windows.update(existing.windowId, { focused: true });
        }
        await chrome.tabs.remove(currentTabId);
        preventedDuplicatesCount++;
        persistState();
        showSwitchedNotice(existing.id);
    } catch (e) {
        console.warn('Prevent Duplicate Tabs: could not switch tabs', e);
    }
}

// Shows a large green "Switched to existing tab" notice on the page for a few
// seconds. Pages where scripts cannot run (chrome://, Chrome Web Store, ...)
// are skipped silently; the badge counter still goes up.
function showSwitchedNotice(tabId) {
    chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
            const id = '__prevent_duplicate_tabs_notice__';
            document.getElementById(id)?.remove();
            const el = document.createElement('div');
            el.id = id;
            el.textContent = 'Switched to existing tab';
            Object.assign(el.style, {
                position: 'fixed',
                top: '32px',
                right: '32px',
                zIndex: '2147483647',
                padding: '16px 24px',
                background: 'rgba(52, 199, 89, 0.95)',
                color: 'white',
                font: "500 26px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                borderRadius: '16px',
                boxShadow: '0 8px 28px rgba(0, 0, 0, 0.18)',
                pointerEvents: 'none',
                opacity: '0',
                transform: 'translateY(-12px)',
                transition: 'opacity 140ms ease, transform 140ms ease',
            });
            document.documentElement.appendChild(el);
            requestAnimationFrame(() => {
                el.style.opacity = '1';
                el.style.transform = 'translateY(0)';
            });
            setTimeout(() => {
                el.style.opacity = '0';
                el.style.transform = 'translateY(-12px)';
                setTimeout(() => el.remove(), 240);
            }, 2400);
        },
    }).catch(() => {});
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
