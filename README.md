# "Prevent Duplicate Tabs" Chrome extension

Chrome extension that detects when a duplicate tab is opened and activates already existing tab. You can temporarily turn it off from the switch in the extension's popup, which also has a button to deduplicate tabs that are already open and a link to the URL matching rules. The icon badge shows the number of duplicate tabs that are open right now, or `OFF` while the extension is switched off, and the popup shows how many duplicates have been prevented so far.

The extension uses [Manifest V3](https://developer.chrome.com/docs/extensions/mv3), so it requires a modern Chrome version. The on/off switch, the URL matching rules and the prevented-duplicates counter are stored in your browser via `chrome.storage.local`.

## How to install

1. (optional, for people with healthy paranoia) This project is very simple, so just look at its files here https://github.com/Litee/prevent-duplicate-tabs-chrome-extension. Check `manifest.json`, `background.js`, `dedupe.js`, `url-rules.js`, `rule-examples.js`, `popup.html`, `popup.js`, `options.html` and `options.js`.
1. Clone extension to your machine - e.g. `git clone https://github.com/Litee/prevent-duplicate-tabs-chrome-extension.git`
1. Open chrome://extensions tab in your Chrome browser
1. Activate developer mode (required for next step)
1. Install extension as unpacked

No build step is needed: the extension is plain JavaScript. The tests need no dependencies either - `node --test` checks the URL comparison and duplicate rules in `dedupe.test.js`, the URL matching rules in `url-rules.test.js` (including the GitHub rules below and every example on the rules page), and the service worker wiring in `background.test.js`.

## How to update

1. (optional, for people with healthy paranoia) This project is very simple, so just look at its files here https://github.com/Litee/prevent-duplicate-tabs-chrome-extension. Check `manifest.json`, `background.js`, `dedupe.js`, `url-rules.js`, `rule-examples.js`, `popup.html`, `popup.js`, `options.html` and `options.js`.
1. Run `git pull` from within the extension project folder.
1. Go to the extension view in Chrome and click "Update" button.

## How duplicates are detected

* The `#fragment` part of a URL is ignored, so `page#a` and `page#b` are the same page.
* `https://example.com` and `https://example.com/` are the same page.
* Query strings are compared, so different searches stay in separate tabs.
* Sites where one page has several addresses can be handled by [URL matching rules](#url-matching-rules). None are set up out of the box.
* When a tab arrives at a URL that another tab already shows, the tab that was already there is the one kept, and the arriving tab is closed. If several tabs already show it, you are switched to the oldest of them.
* "Deduplicate existing tabs" keeps the oldest tab for each URL. Age comes from the tab id, which starts over when the browser does, so after a restart "oldest" means the tab that was restored first.
* Incognito and normal windows are deduplicated separately, so you are never pulled across that boundary. This only matters if you allow the extension in incognito windows.
* New tab pages are never treated as duplicates.
* "Deduplicate existing tabs" never closes pinned tabs, and the popup tells you how many pinned duplicates it kept.
* The existing tab you are switched to is not reloaded, so its scroll position and unsaved input stay as they were.
* The toolbar badge shows the number of duplicate tabs that are currently open, or `OFF` while the extension is switched off.

When you are switched to an existing tab, a large green "Switched to existing tab" notice appears on that page for a few seconds. The `scripting` permission and access to http(s) sites are used only for this notice. It can't appear on pages where extensions can't run scripts, such as `chrome://` pages and the Chrome Web Store.

## URL matching rules

Some sites give one page several addresses. A GitHub pull request is the same pull request whether you are looking at `/files`, `/commits` or a comment link, but the URLs are all different, so comparing URLs on its own would leave you with four tabs on one pull request.

Rules fix that without code. Open them from the popup's "Edit" link next to "URL matching rules" (or the extension's "Extension options" on `chrome://extensions`), paste a JSON array of rules and click Save. A rule is a pattern and a key: a URL that matches the `match` pattern is compared by its expanded `key`, so two tabs whose URLs differ only in the parts the key leaves out are duplicates of each other. No rules are set up out of the box, so until you add some, URLs are compared as they are. The rules page has examples - GitHub pull requests and issues, Stack Overflow questions, Jira issues, Reddit posts - that you can add with one click, and a summary of the pattern language.

### GitHub rules

Copy this into the rules page to treat every view of a GitHub pull request (`/files`, `/commits/<sha>`, `/checks`, `?diff=split`, comment links) as the pull request itself, and the same for issues:

```json
[
    {
        "name": "GitHub pull request views",
        "match": "github.com/{owner}/{repo}/pull/{number:[0-9]+}/**",
        "key": "https://github.com/{owner}/{repo}/pull/{number}"
    },
    {
        "name": "GitHub issue views",
        "match": "github.com/{owner}/{repo}/issues/{number:[0-9]+}/**",
        "key": "https://github.com/{owner}/{repo}/issues/{number}"
    }
]
```

Keep only the first rule if you want issues compared as plain URLs. Pull request 12 and issue 12 stay different pages either way, because their keys differ.

### Pattern language

The pattern language is deliberately smaller than regular expressions:

| Pattern | Matches |
| --- | --- |
| `text` | a literal segment, which must match exactly |
| `{name}` | exactly one non-empty segment, captured as `name` |
| `{name:[0-9]+}` | the same, but only a segment of digits |
| `*` | exactly one segment, not captured |
| `**` | zero or more remaining segments; only as the last part |
| `*.example.com` | a hostname with one or more leading labels |

A character class applies to the whole segment, and `+` - one or more - is the only quantifier, so `{number:[0-9]+}` means "a segment whose every character is a digit". Ranges (`[a-z0-9-]+`) and negation (`[^0-9]+`) work. Anything else a regular expression would allow (`\d`, `.`, `*`, `?`, `{2,4}`, `|`, groups) is refused when you save, with a message naming the rule, and the rules you had before stay in place.

Patterns are matched against the hostname and the path, so the scheme and the query string play no part in matching. Because the key is built only from what the pattern captures, both are dropped from it unless the key spells them out. The first rule that matches a URL wins. URLs that no rule matches are compared by the URL itself, with the fragment and an empty trailing `?` removed.

## TODOs

* Support white lists.
* An alternative strategy: ask about whether to de-duplicate.
* Allow to safely duplicate tabs via context menu even when dedupe is on.

## License

MIT - see [LICENSE](LICENSE).

## Disclaimers

* Icon made by [Picol](https://www.flaticon.com/authors/picol) from [Flaticon](https://www.flaticon.com/) is licensed by [CC 3.0 BY](http://creativecommons.org/licenses/by/3.0/)
