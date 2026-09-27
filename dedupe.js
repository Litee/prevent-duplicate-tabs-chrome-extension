// Duplicate detection, with nothing in here touching the chrome.* APIs: the
// service worker loads this file with importScripts(), and dedupe.test.js runs
// the same functions with plain node.

// Pages that are never duplicates of each other. New tab pages come in several
// shapes, and browser internals cannot be switched to reliably.
const EXCLUDED_URL_PREFIXES = ['about:', 'chrome-search:', 'devtools:'];
const NEW_TAB_PAGE_PATTERN = /^chrome:\/\/new-?tab/;

function isExcludedUrl(url) {
    if (!url) return true;
    if (EXCLUDED_URL_PREFIXES.some(prefix => url.startsWith(prefix))) return true;
    return NEW_TAB_PAGE_PATTERN.test(url);
}

// Builds the key used to decide whether two tabs show the same thing:
// - the #fragment is ignored (`page#a` and `page#b` are the same page);
// - `https://example.com` and `https://example.com/` are the same;
// - a trailing `?` with nothing after it means nothing, so it is dropped;
// - every view of a GitHub pull request (`/files`, `/commits`, `/checks`,
//   `#discussion_r...`, ...) collapses to the pull request itself;
// - query strings are otherwise kept, so different searches stay different tabs.
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

// The comparison key for a tab, or null for a tab that cannot be compared: one
// that has no URL yet (it is still starting), or one showing a page where
// duplicates make no sense. Incognito tabs are only ever duplicates of other
// incognito tabs.
function duplicateKey(tab) {
    if (!tab || isExcludedUrl(tab.url)) return null;
    return `${tab.incognito ? 'incognito' : 'normal'} ${normalizeUrl(tab.url)}`;
}

// Tab ids grow over a browser session, so the smallest id is the oldest tab.
function byAge(a, b) {
    return a.id - b.id;
}

// How many tabs are duplicates of another tab: for each key, every tab after
// the first one is a duplicate. Pinned tabs are counted - they are duplicates
// even though the extension never closes them by itself.
function countDuplicates(tabs) {
    const seenKeys = new Set();
    let duplicates = 0;
    for (const tab of tabs) {
        const key = duplicateKey(tab);
        if (key === null) continue;
        if (seenKeys.has(key)) {
            duplicates++;
        } else {
            seenKeys.add(key);
        }
    }
    return duplicates;
}

// The tabs "Deduplicate existing tabs" would close: the oldest tab for each key
// is kept, and pinned duplicates are never closed.
function planDeduplication(tabs) {
    const seenKeys = new Set();
    const toClose = [];
    let pinnedKept = 0;
    for (const tab of [...tabs].sort(byAge)) {
        const key = duplicateKey(tab);
        if (key === null || tab.id === undefined) continue;
        if (!seenKeys.has(key)) {
            seenKeys.add(key);
            continue;
        }
        if (tab.pinned) {
            pinnedKept++;
        } else {
            toClose.push(tab.id);
        }
    }
    return { toClose, pinnedKept };
}

// The tab to switch to when `currentTabId` turned out to be a duplicate: the
// oldest other tab showing the same URL in the same incognito mode.
function findExistingTab(tabs, currentTabId, key) {
    return tabs
        .filter(tab => tab.id !== undefined && tab.id !== currentTabId && duplicateKey(tab) === key)
        .sort(byAge)[0];
}
