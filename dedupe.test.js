// Run with: node --test
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// dedupe.js is a plain script - the service worker loads it with importScripts
// - so it is evaluated here in a bare context to get at its functions.
const context = vm.createContext({ URL });
vm.runInContext(fs.readFileSync(path.join(__dirname, 'dedupe.js'), 'utf8'), context);
const { countDuplicates, duplicateKey, findExistingTab, isExcludedUrl, normalizeUrl, planDeduplication } = context;

const tab = (id, url, extra = {}) => ({ id, url, incognito: false, pinned: false, ...extra });

test('normalizeUrl drops fragments and empty trailing question marks', () => {
    assert.equal(normalizeUrl('https://example.com/page#one'), 'https://example.com/page');
    assert.equal(normalizeUrl('https://example.com/page#two'), normalizeUrl('https://example.com/page'));
    assert.equal(normalizeUrl('https://example.com/'), normalizeUrl('https://example.com'));
    assert.equal(normalizeUrl('https://example.com/page?'), 'https://example.com/page');
    assert.equal(normalizeUrl('not a url'), 'not a url');
});

test('normalizeUrl compares URLs as they are unless aggressive GitHub matching is on', () => {
    assert.notEqual(normalizeUrl('https://example.com/?q=one'), normalizeUrl('https://example.com/?q=two'));

    const pullRequest = 'https://github.com/owner/repo/pull/12';
    for (const view of [`${pullRequest}/files`, `${pullRequest}/commits/abc123`, `${pullRequest}?diff=split`]) {
        assert.notEqual(normalizeUrl(view), pullRequest, view);
        assert.equal(normalizeUrl(view, true), pullRequest, view);
    }
    // A comment link is a fragment, so it is ignored either way.
    assert.equal(normalizeUrl(`${pullRequest}#discussion_r1`), pullRequest);
    assert.equal(normalizeUrl(`${pullRequest}#discussion_r1`, true), pullRequest);

    assert.notEqual(normalizeUrl('https://example.com/owner/repo/pull/12/files', true), 'https://example.com/owner/repo/pull/12');
});

test('aggressive GitHub matching collapses pull request and issue views by id', () => {
    for (const family of ['pull', 'issues']) {
        const item = `https://github.com/owner/repo/${family}/12`;
        for (const view of [`${item}/`, `${item}/files`, `${item}/commits/abc123`, `${item}?diff=split`]) {
            assert.equal(normalizeUrl(view, true), item, view);
        }
        assert.equal(normalizeUrl(`${item}#issuecomment-1`, true), item);
    }

    const at = url => normalizeUrl(url, true);
    // Different items, different families and other GitHub pages stay different.
    assert.notEqual(at('https://github.com/owner/repo/pull/12'), at('https://github.com/owner/repo/pull/123'));
    assert.notEqual(at('https://github.com/owner/repo/pull/12'), at('https://github.com/owner/repo/issues/12'));
    assert.equal(at('https://github.com/owner/repo/settings'), 'https://github.com/owner/repo/settings');
    assert.notEqual(at('https://github.com/owner/repo/issues/12'), at('https://github.com/owner/repo'));
});

test('the GitHub switch decides which open tabs count as duplicates', () => {
    const tabs = [
        tab(1, 'https://github.com/owner/repo/pull/12'),
        tab(2, 'https://github.com/owner/repo/pull/12/files'),
        tab(3, 'https://github.com/owner/repo/issues/34'),
    ];
    assert.equal(countDuplicates(tabs), 0);
    assert.deepEqual([...planDeduplication(tabs, true).toClose], [2]);
    assert.deepEqual([...planDeduplication(tabs).toClose], []);
    assert.equal(countDuplicates(tabs, true), 1);
});

test('isExcludedUrl covers every shape of new tab page and browser internals', () => {
    const excluded = [
        'about:blank',
        'about:newtab',
        'chrome://newtab/',
        'chrome://new-tab-page/',
        'chrome-search://local-ntp/local-ntp.html',
        'devtools://devtools/bundled/inspector.html',
        '',
        undefined,
    ];
    for (const url of excluded) {
        assert.equal(isExcludedUrl(url), true, String(url));
    }

    for (const url of ['https://example.com', 'file:///tmp/page.html', 'chrome://settings/']) {
        assert.equal(isExcludedUrl(url), false, url);
    }
});

test('duplicateKey separates incognito from normal windows', () => {
    const normal = duplicateKey(tab(1, 'https://example.com'));
    assert.notEqual(normal, duplicateKey(tab(2, 'https://example.com', { incognito: true })));
    assert.equal(normal, duplicateKey(tab(3, 'https://example.com')));
    assert.equal(duplicateKey(tab(4, '')), null);
    assert.equal(duplicateKey({ id: 5 }), null);
});

test('countDuplicates counts every tab after the first one for a key', () => {
    const tabs = [
        tab(1, 'https://a.example/'),
        tab(2, 'https://a.example/#x'),
        tab(3, 'https://b.example/'),
        tab(4, 'chrome://newtab/'),
        tab(5, 'chrome://newtab/'),
    ];
    assert.equal(countDuplicates(tabs), 1);
    assert.equal(countDuplicates([...tabs, tab(6, 'https://a.example')]), 2);
    // Pinned duplicates are duplicates too, the badge shows them.
    assert.equal(countDuplicates([tab(1, 'https://a.example'), tab(2, 'https://a.example', { pinned: true })]), 1);
    // The same URL in an incognito window is not a duplicate of a normal one.
    assert.equal(countDuplicates([tab(1, 'https://a.example'), tab(2, 'https://a.example', { incognito: true })]), 0);
});

test('planDeduplication keeps the oldest tab and never closes pinned ones', () => {
    const tabs = [
        tab(7, 'https://a.example/'),
        tab(3, 'https://a.example/'), // oldest of the a.example group
        tab(9, 'https://a.example/', { pinned: true }),
        tab(4, 'https://b.example/'),
        tab(5, 'https://b.example/'),
        tab(6, 'chrome://newtab/'),
        tab(8, 'chrome://newtab/'),
    ];
    const { toClose, pinnedKept } = planDeduplication(tabs);
    assert.deepEqual([...toClose].sort((a, b) => a - b), [5, 7]);
    assert.equal(pinnedKept, 1);
});

test('findExistingTab finds the oldest other tab with the same URL', () => {
    const tabs = [
        tab(5, 'https://a.example/'),
        tab(2, 'https://a.example/'),
        tab(3, 'https://a.example/', { incognito: true }),
        tab(4, 'https://a.example/', { pinned: true }),
    ];
    const key = duplicateKey(tab(9, 'https://a.example/'));
    assert.equal(findExistingTab(tabs, 9, key).id, 2);
    assert.equal(findExistingTab(tabs, 2, key).id, 4);
    assert.equal(findExistingTab([tab(2, 'https://a.example/')], 2, key), undefined);
    assert.equal(findExistingTab(tabs, 9, duplicateKey(tab(9, 'chrome://newtab/'))), undefined);
});
