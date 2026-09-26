document.addEventListener('DOMContentLoaded', () => {
    const turnOnOff = document.getElementById('menuTurnOnOff');
    if (turnOnOff) {
        turnOnOff.addEventListener('click', () => {
            chrome.runtime.sendMessage({ action: 'TurnOnOff' });
            window.close();
        });
    }

    const deduplicate = document.getElementById('menuDeduplicate');
    if (deduplicate) {
        deduplicate.addEventListener('click', () => {
            chrome.runtime.sendMessage({ action: 'Deduplicate' });
            window.close();
        });
    }
});
