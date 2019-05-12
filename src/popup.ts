document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('menuTurnOnOff').addEventListener('click', () => {
        chrome.runtime.sendMessage({action:'TurnOnOff'});
        window.close();
    });
    document.getElementById('menuDeduplicate').addEventListener('click', () => {
        chrome.runtime.sendMessage({action:'Deduplicate'});
        window.close();
    });
});
