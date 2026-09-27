importScripts('dedupe.js');

let preventedDuplicatesCount = 0;
let active = true;
// Off by default: URLs are compared as they are, except that GitHub item pages
// can be matched by pull request / issue id instead.
let aggressiveGithub = false;

// Badge bookkeeping: the recount generation and the text currently shown.
let badgeGeneration = 0;
let lastBadgeText = null;

// Tabs this extension is closing right now, so their own events are ignored.
const tabsBeingHandled = new Set();

// Checks for one URL run one at a time: two tabs that arrive at the same URL in
// the same moment - ctrl-clicking a link twice, restoring a session, "open all
// bookmarks" - would otherwise each pick the other as the tab to keep and then
// close themselves, leaving no tab on that URL at all. Queueing instead of
// skipping means a third and fourth tab are still deduplicated, each against a
// freshly queried tab list.
const queueByKey = new Map();

// MV3 service workers can be terminated and restarted at any time, so the
// on/off switch and counter are persisted in chrome.storage.local. Everything
// that reads or writes them awaits `stateReady` first: a write must never land
// before the persisted values have been loaded (that would overwrite them with
// stale defaults), and a tab event must never be judged against the defaults
// either.
const stateReady = chrome.storage.local.get(['active', 'aggressiveGithub', 'preventedDuplicatesCount']).then(stored => {
    active = stored.active ?? true;
    aggressiveGithub = stored.aggressiveGithub ?? false;
    preventedDuplicatesCount = stored.preventedDuplicatesCount ?? 0;
}).catch(e => {
    // Carry on with the defaults instead of rejecting: every tab event awaits
    // this promise, and a rejected one would throw on each of them.
    console.warn('Prevent Duplicate Tabs: could not read the stored state', e);
});

chrome.action.setBadgeBackgroundColor({ color: '#28a745' });

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'SetActive') {
        void stateReady
            .then(() => {
                active = Boolean(request.active);
                persistState();
                sendResponse({ active, aggressiveGithub, preventedDuplicatesCount });
            })
            .catch(e => console.warn('Prevent Duplicate Tabs: could not switch the extension', e));
        return true;
    }
    if (request.action === 'SetGithubMode') {
        void stateReady
            .then(() => {
                aggressiveGithub = Boolean(request.aggressiveGithub);
                persistState();
                // Which URLs count as duplicates just changed, so the badge does too.
                void updateBadge();
                sendResponse({ active, aggressiveGithub, preventedDuplicatesCount });
            })
            .catch(e => console.warn('Prevent Duplicate Tabs: could not switch the GitHub mode', e));
        return true;
    }
    if (request.action === 'Deduplicate') {
        void stateReady
            .then(() => deduplicateExistingTabs())
            .then(result => sendResponse({ ...result, active, aggressiveGithub, preventedDuplicatesCount }), e => {
                // No response on failure: the popup reports the closed message
                // port as an error instead of a bogus "0 duplicates" result.
                console.warn('Prevent Duplicate Tabs: could not deduplicate the open tabs', e);
            });
        return true;
    }
    if (request.action === 'GetState') {
        void stateReady
            .then(() => sendResponse({ active, aggressiveGithub, preventedDuplicatesCount }))
            .catch(e => console.warn('Prevent Duplicate Tabs: could not read the state', e));
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
    if (!active) return;
    await verifyAndDeduplicate(newTab);
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
    if (changeInfo.url) {
        void updateBadge();
        await stateReady;
        if (!active) return;
        await verifyAndDeduplicate(tab);
    }
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

async function deduplicateExistingTabs() {
    const tabs = await chrome.tabs.query({});
    const { toClose, pinnedKept } = planDeduplication(tabs, aggressiveGithub);
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

// Closes a tab that duplicates one that is already open, then switches to the
// tab that was there first.
function verifyAndDeduplicate(tab) {
    const key = duplicateKey(tab, aggressiveGithub);
    if (key === null || tab.id === undefined || tabsBeingHandled.has(tab.id)) {
        return Promise.resolve();
    }
    const done = (queueByKey.get(key) ?? Promise.resolve())
        .then(() => switchToExistingTab(tab.id, key))
        .catch(e => console.warn('Prevent Duplicate Tabs: could not switch tabs', e))
        .finally(() => {
            if (queueByKey.get(key) === done) {
                queueByKey.delete(key);
            }
        });
    queueByKey.set(key, done);
    return done;
}

async function switchToExistingTab(currentTabId, key) {
    try {
        const tabs = await chrome.tabs.query({});
        const current = tabs.find(tab => tab.id === currentTabId);
        // The tab can be gone already (closed by the user or by a check that was
        // queued ahead of this one), pinned, or it may have navigated on since
        // it was queued - in which case closing it would close the page the user
        // is now looking at.
        if (!current || current.pinned || duplicateKey(current, aggressiveGithub) !== key) return;

        const existing = findExistingTab(tabs, currentTabId, key);
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
// seconds. Pages where scripts cannot run (chrome://, the Chrome Web Store, ...)
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
        aggressiveGithub,
        preventedDuplicatesCount,
    }).catch(e => console.warn('Prevent Duplicate Tabs: could not save the state', e));
}

// The badge shows how many open tabs are duplicates of another open tab.
// Recounts are taken one at a time and only the newest one is applied, so a slow
// recount can never overwrite the result of a later one.
async function updateBadge() {
    const generation = ++badgeGeneration;
    try {
        const duplicates = countDuplicates(await chrome.tabs.query({}), aggressiveGithub);
        // Chrome truncates badge text to ~4 characters.
        const text = duplicates === 0 ? '' : duplicates >= 1000 ? '999+' : `${duplicates}`;
        if (generation !== badgeGeneration || text === lastBadgeText) return;
        lastBadgeText = text;
        await chrome.action.setBadgeText({ text });
    } catch (e) {
        console.warn('Prevent Duplicate Tabs: could not update the badge', e);
    }
}
