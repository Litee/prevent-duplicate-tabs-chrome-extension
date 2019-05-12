# "Prevent Duplicate Tabs" Chrome extension

Chrome extension that detects when a duplicate tab is opened and activates already existing tab. You can temporary turn it off by clicking extension's icon. Icon badge is showing the number of prevented duplicates.

## How to install

1. Clone extension to your machine - e.g. `git clone https://github.com/Litee/prevent-duplicate-tabs-chrome-extension.git`
1. Look into `manifest.json` and `src/background.js`. It is always a good idea to check that code does not do anything suspicious and does not have too many permissions ;)
1. Build the project using `npm run build`
1. Open chrome://extensions tab in your Chrome browser
1. Activate developer mode (required for next step)
1. Install extension as unpacked

Ping me if you liked this extension and I may consider publishing it into Chrome Web Store.

## TODOs

* Support white lists

## Disclaimers

* Icon made by [Picol](https://www.flaticon.com/authors/picol) from [Flaticon](https://www.flaticon.com/) is licensed by [CC 3.0 BY](http://creativecommons.org/licenses/by/3.0/)
