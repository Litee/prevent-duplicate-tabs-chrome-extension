// Run with: node --test
// Loads the service worker with a stubbed chrome API and drives it with tab
// events, so the wiring between events, deduplication and the badge is covered.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const backgroundSource = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');

const tab = (id, url, extra = {}) => ({ id, url, incognito: false, pinned: false, windowId: 1, ...extra });

function loadWorker(tabs, stored = {}) {
    const actions = [];
    const badgeColors = [];
    const badgeTexts = [];
    const listeners = {};
    const chrome = {
        storage: { local: { get: () => Promise.resolve(stored), set: values => { Object.assign(stored, values); return Promise.resolve(); } } },
        action: {
            setBadgeBackgroundColor: ({ color }) => { badgeColors.push(color); return Promise.resolve(); },
            setBadgeText: ({ text }) => { badgeTexts.push(text); return Promise.resolve(); },
        },
        runtime: { onMessage: { addListener: fn => { listeners.message = fn; } } },
        tabs: {
            query: () => Promise.resolve(tabs),
            update: (id, props) => {
                actions.push(`activate ${id}${props.active ? '' : ' (without activating!)'}`);
                return Promise.resolve({ id, windowId: 1 });
            },
            remove: id => {
                actions.push(`close ${id}`);
                const index = tabs.findIndex(tab => tab.id === id);
                if (index >= 0) tabs.splice(index, 1);
                return Promise.resolve();
            },
            onCreated: { addListener: fn => { listeners.created = fn; } },
            onUpdated: { addListener: fn => { listeners.updated = fn; } },
            onRemoved: { addListener: () => {} },
            onReplaced: { addListener: () => {} },
        },
        windows: { update: () => Promise.resolve() },
        scripting: { executeScript: () => Promise.resolve([]) },
    };
    const context = vm.createContext({
        chrome,
        console,
        URL,
        // The real importScripts takes any number of files, in order.
        importScripts: (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context)),
    });
    vm.runInContext(backgroundSource, context);
    // Lets the startup badge recount and the stored-state read settle.
    const settle = () => new Promise(resolve => setTimeout(resolve, 20));
    return { actions, badgeColors, badgeTexts, listeners, settle };
}

const closes = actions => actions.filter(action => action.startsWith('close'));

// Sends a message to the worker the way the popup and the options page do.
const send = (worker, message) => new Promise(resolve => worker.listeners.message(message, {}, resolve));

test('the worker starts up and puts the number of open duplicates on the badge', async () => {
    const worker = loadWorker([tab(1, 'https://a.example/'), tab(2, 'https://a.example/'), tab(3, 'https://b.example/')]);
    await worker.settle();
    assert.deepEqual(worker.badgeTexts, ['1']);
    assert.deepEqual(worker.badgeColors, ['#28a745']);
    assert.deepEqual(worker.actions, []);
});

test('the badge says OFF and greys out while the extension is switched off', async () => {
    const worker = loadWorker([tab(1, 'https://a.example/'), tab(2, 'https://a.example/')]);
    await worker.settle();
    assert.equal(worker.badgeTexts.at(-1), '1');

    const off = await send(worker, { action: 'SetActive', active: false });
    await worker.settle();
    assert.equal(off.active, false);
    assert.equal(worker.badgeTexts.at(-1), 'OFF');
    assert.equal(worker.badgeColors.at(-1), '#666666');

    // Switching it back on restores the live count.
    const on = await send(worker, { action: 'SetActive', active: true });
    await worker.settle();
    assert.equal(on.active, true);
    assert.equal(worker.badgeTexts.at(-1), '1');
    assert.equal(worker.badgeColors.at(-1), '#28a745');
});

test('a worker that starts up switched off never shows a count', async () => {
    const worker = loadWorker([tab(1, 'https://a.example/'), tab(2, 'https://a.example/')], { active: false });
    await worker.settle();
    assert.deepEqual(worker.badgeTexts, ['OFF']);
    assert.deepEqual(worker.badgeColors, ['#666666']);
});

test('a duplicate is closed and the tab that was there first is activated', async () => {
    const worker = loadWorker([tab(1, 'https://a.example/'), tab(5, 'https://a.example/')]);
    await worker.settle();
    await worker.listeners.created(tab(5, 'https://a.example/'));
    await worker.settle();
    assert.deepEqual(worker.actions, ['activate 1', 'close 5']);
});

test('a pinned duplicate is never closed but is still counted', async () => {
    const worker = loadWorker([tab(1, 'https://a.example/'), tab(5, 'https://a.example/', { pinned: true })]);
    const pinned = tab(5, 'https://a.example/', { pinned: true });
    await worker.settle();
    await worker.listeners.created(pinned);
    await worker.settle();
    assert.deepEqual(worker.actions, []);
    assert.equal(worker.badgeTexts.at(-1), '1');
});

test('new tab pages and browser internals are never duplicates', async () => {
    const worker = loadWorker([
        tab(1, 'chrome://newtab/'),
        tab(2, 'chrome://newtab/'),
        tab(3, 'chrome-search://local-ntp/local-ntp.html'),
        tab(4, 'chrome-search://local-ntp/local-ntp.html'),
    ]);
    await worker.settle();
    assert.deepEqual(worker.actions, []);
    assert.equal(worker.badgeTexts.at(-1), '');
});

test('two tabs arriving at the same URL at once leave exactly one', async () => {
    const worker = loadWorker([tab(4, 'https://new.example/'), tab(5, 'https://new.example/')]);
    await worker.settle();
    const arrived = [
        worker.listeners.created(tab(4, 'https://new.example/')),
        worker.listeners.created(tab(5, 'https://new.example/')),
    ];
    await Promise.all(arrived);
    await worker.settle();
    assert.equal(closes(worker.actions).length, 1);
});

test('the same URL in an incognito window is not a duplicate', async () => {
    const worker = loadWorker([tab(1, 'https://a.example/'), tab(5, 'https://a.example/', { incognito: true })]);
    await worker.settle();
    await worker.listeners.created(tab(5, 'https://a.example/', { incognito: true }));
    await worker.settle();
    assert.deepEqual(worker.actions, []);
});

test('a tab that navigated on since its check was queued is left alone', async () => {
    const worker = loadWorker([tab(1, 'https://a.example/'), tab(5, 'https://b.example/')]);
    await worker.settle();
    await worker.listeners.created(tab(5, 'https://a.example/'));
    await worker.settle();
    assert.deepEqual(worker.actions, []);
});

const pullRequestRule = {
    name: 'pull requests',
    match: 'github.com/{owner}/{repo}/pull/{number:[0-9]+}/**',
    key: 'https://github.com/{owner}/{repo}/pull/{number}',
};

test('a pull request and its "files" view are different pages without rules', async () => {
    const worker = loadWorker([
        tab(1, 'https://github.com/owner/repo/pull/12'),
        tab(2, 'https://github.com/owner/repo/pull/12/files'),
    ]);
    await worker.settle();
    assert.equal(worker.badgeTexts.at(-1), '');
});

test('stored rules are applied from the first tab event on', async () => {
    const tabs = [tab(1, 'https://github.com/owner/repo/pull/12')];
    const worker = loadWorker(tabs, { urlRules: [pullRequestRule] });
    const arriving = tab(9, 'https://github.com/owner/repo/pull/12/commits/abc123');
    tabs.push(arriving);
    await worker.listeners.created(arriving);
    await worker.settle();
    assert.deepEqual(worker.actions, ['activate 1', 'close 9']);
});

test('saved rules are stored and change which tabs are duplicates', async () => {
    const stored = {};
    const worker = loadWorker([
        tab(1, 'https://github.com/owner/repo/pull/12'),
        tab(2, 'https://github.com/owner/repo/pull/12/files'),
    ], stored);
    await worker.settle();
    const state = await send(worker, { action: 'SetUrlRules', urlRules: [pullRequestRule] });
    await worker.settle();
    assert.equal(state.error, undefined);
    assert.deepEqual(state.urlRules, [pullRequestRule]);
    assert.deepEqual(stored.urlRules, [pullRequestRule]);
    assert.equal(worker.badgeTexts.at(-1), '1');
});

test('rules that cannot be understood are refused and the old ones kept', async () => {
    const stored = { urlRules: [pullRequestRule] };
    const worker = loadWorker([], stored);
    await worker.settle();
    const state = await send(worker, { action: 'SetUrlRules', urlRules: [{ name: 'broken', match: 'example.com/{id:\\d+}', key: '{id}' }] });
    assert.match(state.error, /broken/);
    assert.deepEqual(state.urlRules, [pullRequestRule]);
    assert.deepEqual(stored.urlRules, [pullRequestRule]);
});
