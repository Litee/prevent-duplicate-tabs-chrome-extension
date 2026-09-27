let preventedDuplicatesCount = 0;
let active = true;

// Tabs this extension is closing right now, so their own events are ignored.
const tabsBeingHandled = new Set();

// MV3 service workers can be terminated and restarted at any time, so the
// on/off switch and counter are persisted in chrome.storage.local. Everything
// that reads or writes them awaits `stateReady` first: a write must never land
// before the persisted values have been loaded (that would overwrite them with
// stale defaults), and a tab event must never be judged against the defaults
// either.
const stateReady = chrome.storage.local.get(['active', 'preventedDuplicatesCount']).then(stored => {
    active = stored.active ?? true;
    preventedDuplicatesCount = stored.preventedDuplicatesCount ?? 0;
}).catch(e => {
    // Carry on with the defaults instead of rejecting: every tab event awaits
    // this promise, and a rejected one would throw on each of them.
    console.warn('Prevent Duplicate Tabs: could not read the stored state', e);
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

chrome.action.setBadgeBackgroundColor({ color: '#28a745' });

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

// The service worker is usually started *by* the tab event it has to handle, so
// these listeners await `stateReady` instead of bailing out while the persisted
// state is still loading. Bailing out would drop the first duplicate after every
// idle shutdown, which makes the extension look like it only works sometimes.
chrome.tabs.onCreated.addListener(async newTab => {
    void updateBadge();
    await stateReady;
    if (!active || newTab.id === undefined || !newTab.url) {
        return;
    }
    await verifyAndDeduplicate(newTab.id, newTab.url);
});

chrome.tabs.onUpdated.addListener(async (updatedTabId, updateInfo) => {
    if (updateInfo.url) {
        void updateBadge();
    }
    await stateReady;
    if (!active || !updateInfo.url) {
        return;
    }
    await verifyAndDeduplicate(updatedTabId, updateInfo.url);
});

// Tabs being closed (by the user or by this extension) and prerender swaps
// change how many duplicates are open, so recount for those too.
chrome.tabs.onRemoved.addListener(() => {
    void updateBadge();
});

chrome.tabs.onReplaced.addListener(() => {
    void updateBadge();
});

void updateBadge();

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
        const key = normalizeUrl(tab.url);
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
    showSwitchedNotice(oldest.id);
}

// Shows a large green "Switched to existing tab" notice on the page for a few
// seconds. Pages where scripts cannot run (chrome://, Chrome Web Store, ...)
// are skipped silently; switching to the existing tab still happens.
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
}

// The badge shows how many open tabs are duplicates of another open tab: for
// each normalized URL, every tab after the first one is a duplicate.
async function countDuplicateTabs() {
    const tabs = await chrome.tabs.query({});
    const seenUrlKeys = new Set();
    let duplicates = 0;
    for (const tab of tabs) {
        if (tab.url === undefined || isNewTabPage(tab.url)) continue;
        const key = normalizeUrl(tab.url);
        if (seenUrlKeys.has(key)) {
            duplicates++;
        } else {
            seenUrlKeys.add(key);
        }
    }
    return duplicates;
}

let lastBadgeText = null;

async function updateBadge() {
    const duplicates = await countDuplicateTabs();
    // Chrome truncates badge text to ~4 characters.
    const text = duplicates === 0 ? '' : duplicates >= 1000 ? '999+' : `${duplicates}`;
    if (text === lastBadgeText) return;
    lastBadgeText = text;
    chrome.action.setBadgeText({ text });
}
