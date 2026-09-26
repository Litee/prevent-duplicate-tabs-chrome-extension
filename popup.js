const toggle = document.getElementById('toggle');
const stateLabel = document.getElementById('stateLabel');
const counter = document.getElementById('counter');
const deduplicate = document.getElementById('deduplicate');
const status = document.getElementById('status');

function render({ active, preventedDuplicatesCount }) {
    toggle.checked = active;
    stateLabel.textContent = active ? 'Enabled' : 'Disabled';
    counter.textContent = `Duplicates prevented so far: ${preventedDuplicatesCount}.`;
}

function showStatus(text, kind = '') {
    status.textContent = text;
    status.className = `status ${kind}`;
}

toggle.addEventListener('change', async () => {
    render(await chrome.runtime.sendMessage({ action: 'SetActive', active: toggle.checked }));
});

deduplicate.addEventListener('click', async () => {
    deduplicate.disabled = true;
    showStatus('Scanning...');
    try {
        const result = await chrome.runtime.sendMessage({ action: 'Deduplicate' });
        render({ active: toggle.checked, preventedDuplicatesCount: result.preventedDuplicatesCount });
        const plural = count => (count === 1 ? 'tab' : 'tabs');
        let text = result.closed === 0
            ? `No duplicates closed across ${result.scanned} tabs.`
            : `Closed ${result.closed} duplicate ${plural(result.closed)} of ${result.scanned}.`;
        showStatus(text, result.closed > 0 ? 'ok' : '');
    } catch (e) {
        showStatus(`Error: ${e?.message ?? e}`, 'error');
    } finally {
        deduplicate.disabled = false;
    }
});

chrome.runtime.sendMessage({ action: 'GetState' }).then(render);
