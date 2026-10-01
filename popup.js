const toggle = document.getElementById('toggle');
const stateLabel = document.getElementById('stateLabel');
const rulesLabel = document.getElementById('rulesLabel');
const openRules = document.getElementById('openRules');
const counter = document.getElementById('counter');
const deduplicate = document.getElementById('deduplicate');
const status = document.getElementById('status');

function render({ active, urlRules, preventedDuplicatesCount }) {
    toggle.checked = active;
    stateLabel.textContent = active ? 'Enabled' : 'Disabled';
    const ruleCount = Array.isArray(urlRules) ? urlRules.length : 0;
    rulesLabel.textContent = `URL matching rules: ${ruleCount === 0 ? 'none' : ruleCount}`;
    counter.textContent = `Duplicates prevented so far: ${preventedDuplicatesCount}.`;
}

function showStatus(text, kind = '') {
    status.textContent = text;
    status.className = `status ${kind}`;
}

// The background service worker can fail to answer (it is starting up, or the
// extension was just reloaded), so every message shows the failure instead of
// leaving the popup silently stuck on whatever it happened to be displaying.
function showError(e) {
    showStatus(`Error: ${e?.message ?? e}`, 'error');
}

const plural = count => (count === 1 ? 'tab' : 'tabs');

toggle.addEventListener('change', async () => {
    try {
        render(await chrome.runtime.sendMessage({ action: 'SetActive', active: toggle.checked }));
    } catch (e) {
        showError(e);
    }
});

openRules.addEventListener('click', event => {
    event.preventDefault();
    chrome.runtime.openOptionsPage().catch(showError);
});

deduplicate.addEventListener('click', async () => {
    deduplicate.disabled = true;
    showStatus('Scanning...');
    try {
        const result = await chrome.runtime.sendMessage({ action: 'Deduplicate' });
        render(result);
        let text = result.closed === 0
            ? `No duplicates closed across ${result.scanned} tabs.`
            : `Closed ${result.closed} duplicate ${plural(result.closed)} of ${result.scanned}.`;
        if (result.pinnedKept > 0) {
            text += ` Kept ${result.pinnedKept} pinned duplicate ${plural(result.pinnedKept)}.`;
        }
        showStatus(text, result.closed > 0 ? 'ok' : '');
    } catch (e) {
        showError(e);
    } finally {
        deduplicate.disabled = false;
    }
});

chrome.runtime.sendMessage({ action: 'GetState' }).then(render).catch(showError);
