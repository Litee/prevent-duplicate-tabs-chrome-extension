# "Prevent Duplicate Tabs" Chrome extension

Chrome extension that detects when a duplicate tab is opened and activates already existing tab. You can temporarily turn it off from the switch in the extension's popup; the popup also has a switch for aggressive GitHub deduplication and a button to deduplicate tabs that are already open. The icon badge shows the number of duplicate tabs that are open right now, and the popup shows how many duplicates have been prevented so far.

The extension uses [Manifest V3](https://developer.chrome.com/docs/extensions/mv3), so it requires a modern Chrome version. The on/off switch and the prevented-duplicates counter are stored in your browser via `chrome.storage.local`.

## How to install

1. (optional, for people with healthy paranoia) This project is very simple, so just look at its files here https://github.com/Litee/prevent-duplicate-tabs-chrome-extension. Check `manifest.json`, `background.js`, `dedupe.js`, `popup.html` and `popup.js`.
1. Clone extension to your machine - e.g. `git clone https://github.com/Litee/prevent-duplicate-tabs-chrome-extension.git`
1. Open chrome://extensions tab in your Chrome browser
1. Activate developer mode (required for next step)
1. Install extension as unpacked

No build step is needed: the extension is plain JavaScript. The tests need no dependencies either - `node --test` checks the URL comparison and duplicate rules in `dedupe.test.js` and the service worker wiring in `background.test.js`.

## How to update

1. (optional, for people with healthy paranoia) This project is very simple, so just look at its files here https://github.com/Litee/prevent-duplicate-tabs-chrome-extension. Check `manifest.json`, `background.js`, `dedupe.js`, `popup.html` and `popup.js`.
1. Run `git pull` from within the extension project folder.
1. Go to the extension view in Chrome and click "Update" button.

## How duplicates are detected

* The `#fragment` part of a URL is ignored, so `page#a` and `page#b` are the same page.
* `https://example.com` and `https://example.com/` are the same page.
* Every view of a GitHub pull request or issue (`/files`, `/commits/<sha>`, `/checks`, comment links) counts as the same page when the popup's aggressive GitHub deduplication switch is on. It is off by default, so `/pull/12/files` and `/pull/12` are different pages.
* Query strings are compared, so different searches stay in separate tabs.
* When a tab arrives at a URL that another tab already shows, the tab that was already there is the one kept, and the arriving tab is closed. If several tabs already show it, you are switched to the oldest of them.
* "Deduplicate existing tabs" keeps the oldest tab for each URL. Age comes from the tab id, which starts over when the browser does, so after a restart "oldest" means the tab that was restored first.
* Incognito and normal windows are deduplicated separately, so you are never pulled across that boundary. This only matters if you allow the extension in incognito windows.
* New tab pages are never treated as duplicates.
* "Deduplicate existing tabs" never closes pinned tabs, and the popup tells you how many pinned duplicates it kept.
* The existing tab you are switched to is not reloaded, so its scroll position and unsaved input stay as they were.
* The toolbar badge shows the number of duplicate tabs that are currently open.

When you are switched to an existing tab, a large green "Switched to existing tab" notice appears on that page for a few seconds. The `scripting` permission and access to http(s) sites are used only for this notice. It can't appear on pages where extensions can't run scripts, such as `chrome://` pages and the Chrome Web Store.

## TODOs

* Support white lists.
* An alternative strategy: ask about whether to de-duplicate.
* Allow to safely duplicate tabs via context menu even when dedupe is on.

## License

MIT - see [LICENSE](LICENSE).

## Disclaimers

* Icon made by [Picol](https://www.flaticon.com/authors/picol) from [Flaticon](https://www.flaticon.com/) is licensed by [CC 3.0 BY](http://creativecommons.org/licenses/by/3.0/)
