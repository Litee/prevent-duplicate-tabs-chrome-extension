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
    // A trailing `?` with nothing after it survives `toString()` even though it
    // means nothing, so `page?` would not match `page`. Assigning the (empty)
    // search back drops it.
    if (!parsed.search) {
        parsed.search = '';
    }

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
    let closed = 0;
    if (toClose.length > 0) {
        toClose.forEach(id => tabsBeingHandled.add(id));
        // Removed one at a time and counted by outcome: passing every id to a
        // single chrome.tabs.remove call means one stale id - a tab the user
        // closed while the scan ran - rejects the whole batch and abandons the
        // rest of the duplicates.
        const outcomes = await Promise.allSettled(toClose.map(id => chrome.tabs.remove(id)));
        toClose.forEach(id => tabsBeingHandled.delete(id));
        closed = outcomes.filter(outcome => outcome.status === 'fulfilled').length;
        if (closed > 0) {
            preventedDuplicatesCount += closed;
            persistState();
        }
    }
    return { scanned: tabs.length, closed, pinnedKept };
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
