# "Prevent Duplicate Tabs" Chrome extension

Chrome extension that detects when a duplicate tab is opened and activates already existing tab. You can temporary turn it off by clicking extension's icon. Icon badge is showing the number of prevented duplicates.

## How to install

1. (optional, for people with healthy paranoia) This project is very simple, so just look at its files here https://github.com/Litee/prevent-duplicate-tabs-chrome-extension. Check two files in `src` folder, `manifest.json` and `popup.html`.
1. Clone extension to your machine - e.g. `git clone https://github.com/Litee/prevent-duplicate-tabs-chrome-extension.git`
1. Build the project using `npm run build`
1. Open chrome://extensions tab in your Chrome browser
1. Activate developer mode (required for next step)
1. Install extension as unpacked

## How to update

1. (optional, for people with healthy paranoia) This project is very simple, so just look at its files here https://github.com/Litee/prevent-duplicate-tabs-chrome-extension. Check two files in `src` folder, `manifest.json` and `popup.html`.
1. Run `git pull` from within the extension project folder.
1. Build the project using `npm run build`.
1. Go to the extension view in Chrome and click "Update" button.

## TODOs

* Support white lists.
* An alternative strategy: ask about whether to de-duplicate.
* Allow to safely duplicate tabs via context menu even when dedupe is on.

## Disclaimers

* Icon made by [Picol](https://www.flaticon.com/authors/picol) from [Flaticon](https://www.flaticon.com/) is licensed by [CC 3.0 BY](http://creativecommons.org/licenses/by/3.0/)
