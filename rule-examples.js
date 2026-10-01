// Example URL matching rules, offered in the options page to copy from. None of
// them is active until it is added there and saved. Each one comes with two
// URLs it treats as the same page, which url-rules.test.js checks, and maybe a
// note shown next to it.
const URL_RULE_EXAMPLES = [
    {
        rule: {
            name: 'GitHub pull request views',
            match: 'github.com/{owner}/{repo}/pull/{number:[0-9]+}/**',
            key: 'https://github.com/{owner}/{repo}/pull/{number}',
        },
        sameAs: ['https://github.com/owner/repo/pull/12', 'https://github.com/owner/repo/pull/12/files?diff=split'],
    },
    {
        rule: {
            name: 'GitHub issue views',
            match: 'github.com/{owner}/{repo}/issues/{number:[0-9]+}/**',
            key: 'https://github.com/{owner}/{repo}/issues/{number}',
        },
        sameAs: ['https://github.com/owner/repo/issues/34', 'https://github.com/owner/repo/issues/34/linked_closing_reference'],
    },
    {
        note: 'The title in the URL is optional and changes when the question is edited; the id does not.',
        rule: {
            name: 'Stack Overflow questions',
            match: 'stackoverflow.com/questions/{id:[0-9]+}/**',
            key: 'https://stackoverflow.com/questions/{id}',
        },
        sameAs: ['https://stackoverflow.com/questions/11227809', 'https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster?noredirect=1'],
    },
    {
        note: 'Replace example.atlassian.net with your Jira site in both places. *.atlassian.net would match every site, but the key could not tell two sites\' PROJ-123 apart.',
        rule: {
            name: 'Jira issues',
            match: 'example.atlassian.net/browse/{issue:[A-Z0-9_-]+}/**',
            key: 'https://example.atlassian.net/browse/{issue}',
        },
        sameAs: ['https://example.atlassian.net/browse/PROJ-123', 'https://example.atlassian.net/browse/PROJ-123?focusedCommentId=456'],
    },
    {
        rule: {
            name: 'Reddit posts',
            match: 'www.reddit.com/r/{subreddit}/comments/{id}/**',
            key: 'https://www.reddit.com/r/{subreddit}/comments/{id}',
        },
        sameAs: ['https://www.reddit.com/r/chrome/comments/abc123/some_title/', 'https://www.reddit.com/r/chrome/comments/abc123/some_title/def456/'],
    },
];
