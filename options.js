const rules = document.getElementById('rules');
const save = document.getElementById('save');
const status = document.getElementById('status');

function showStatus(text, kind = '') {
    status.textContent = text;
    status.className = `status ${kind}`;
}

function render({ urlRules }) {
    rules.value = JSON.stringify(urlRules ?? [], null, 4);
    rules.disabled = false;
    save.disabled = false;
}

// The worker checks the rules and refuses the whole table if any rule is wrong,
// so a typo never replaces rules that work. JSON syntax is checked here first,
// where the parser's message can still point at the line.
save.addEventListener('click', async () => {
    let urlRules;
    try {
        urlRules = JSON.parse(rules.value.trim() === '' ? '[]' : rules.value);
    } catch (e) {
        showStatus(`Not valid JSON: ${e.message}`, 'error');
        return;
    }
    save.disabled = true;
    try {
        const state = await chrome.runtime.sendMessage({ action: 'SetUrlRules', urlRules });
        if (state.error) {
            showStatus(`Not saved. ${state.error}`, 'error');
            return;
        }
        render(state);
        const count = state.urlRules.length;
        showStatus(`Saved ${count} ${count === 1 ? 'rule' : 'rules'}.`, 'ok');
    } catch (e) {
        showStatus(`Error: ${e?.message ?? e}`, 'error');
    } finally {
        save.disabled = false;
    }
});

// Appends an example to the rules being edited. Nothing is saved: the rules are
// checked and stored by Save, as if they had been typed in.
function addExample(rule) {
    let current;
    try {
        current = JSON.parse(rules.value.trim() === '' ? '[]' : rules.value);
    } catch (e) {
        showStatus(`Fix the JSON above before adding an example: ${e.message}`, 'error');
        return;
    }
    if (!Array.isArray(current)) {
        showStatus('The rules above have to be a JSON array before an example can be added to them.', 'error');
        return;
    }
    if (current.some(existing => existing?.match === rule.match)) {
        showStatus(`"${rule.name}" is already in the rules.`);
        return;
    }
    rules.value = JSON.stringify([...current, rule], null, 4);
    showStatus(`Added "${rule.name}". Click Save to use it.`);
}

function renderExamples() {
    const container = document.getElementById('examples');
    for (const { rule, note, sameAs } of URL_RULE_EXAMPLES) {
        const card = document.createElement('div');
        card.className = 'example';

        const text = document.createElement('div');
        const name = document.createElement('div');
        name.className = 'example-name';
        name.textContent = rule.name;
        text.append(name);
        if (note) {
            const noteLine = document.createElement('div');
            noteLine.className = 'example-note';
            noteLine.textContent = note;
            text.append(noteLine);
        }
        const json = document.createElement('pre');
        json.textContent = JSON.stringify(rule, null, 4);
        const same = document.createElement('div');
        same.className = 'same';
        same.textContent = `Same page: ${sameAs.join('  and  ')}`;
        text.append(json, same);

        const add = document.createElement('button');
        add.textContent = 'Add';
        add.addEventListener('click', () => {
            if (rules.disabled) return;
            addExample(rule);
        });

        card.append(text, add);
        container.append(card);
    }
}

renderExamples();

chrome.runtime.sendMessage({ action: 'GetState' })
    .then(render)
    .catch(e => showStatus(`Error: ${e?.message ?? e}`, 'error'));
