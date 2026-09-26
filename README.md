# "Prevent Duplicate Tabs" Chrome extension

Chrome extension that detects when a duplicate tab is opened and activates already existing tab. You can temporarily turn it off by clicking extension's icon. Icon badge is showing the number of prevented duplicates.

The extension uses [Manifest V3](https://developer.chrome.com/docs/extensions/mv3), so it requires a modern Chrome version. The on/off switch and the prevented-duplicates counter are stored in your browser via `chrome.storage.local`.

## How to install

1. (optional, for people with healthy paranoia) This project is very simple, so just look at its files here https://github.com/Litee/prevent-duplicate-tabs-chrome-extension. Check `manifest.json`, `background.js` and `popup.html`.
1. Clone extension to your machine - e.g. `git clone https://github.com/Litee/prevent-duplicate-tabs-chrome-extension.git`
1. Open chrome://extensions tab in your Chrome browser
1. Activate developer mode (required for next step)
1. Install extension as unpacked

No build step is needed: the extension is plain JavaScript.

## How to update

1. (optional, for people with healthy paranoia) This project is very simple, so just look at its files here https://github.com/Litee/prevent-duplicate-tabs-chrome-extension. Check `manifest.json`, `background.js` and `popup.html`.
1. Run `git pull` from within the extension project folder.
1. Go to the extension view in Chrome and click "Update" button.

## How duplicates are detected

* The `#fragment` part of a URL is ignored, so `page#a` and `page#b` are the same page.
* `https://example.com` and `https://example.com/` are the same page.
* Every view of a GitHub pull request (`/files`, `/commits`, `/checks`, comment links) counts as the same pull request.
* Query strings are compared, so different searches stay in separate tabs.
* The oldest tab is always the one that is kept.
* New tab pages are never treated as duplicates.
* The existing tab you are switched to is not reloaded, so its scroll position and unsaved input stay as they were.

## TODOs

* Support white lists.
* An alternative strategy: ask about whether to de-duplicate.
* Allow to safely duplicate tabs via context menu even when dedupe is on.

## Disclaimers

* Icon made by [Picol](https://www.flaticon.com/authors/picol) from [Flaticon](https://www.flaticon.com/) is licensed by [CC 3.0 BY](http://creativecommons.org/licenses/by/3.0/)
