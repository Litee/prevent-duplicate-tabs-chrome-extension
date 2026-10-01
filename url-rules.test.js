// Run with: node --test
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// url-rules.js is a plain script - the service worker loads it with
// importScripts - so it is evaluated here in a bare context to get at its
// functions.
const context = vm.createContext({ URL });
for (const file of ['url-rules.js', 'rule-examples.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context);
}
const { applyUrlRules, compileUrlRules } = context;
// A const in a script is not a property of the context, so it is fetched by name.
const examples = vm.runInContext('URL_RULE_EXAMPLES', context);

// The GitHub rules are the README's only ```json block, taken from there so
// that the rules people copy into the options page are the rules tested here.
const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
const githubRules = JSON.parse(readme.match(/```json\n([\s\S]*?)```/)[1]);

// The key a set of rules gives a URL, or null when none of them match it.
const keyFor = (rules, url) => applyUrlRules(new URL(url), compileUrlRules(rules));
const githubKeyFor = url => keyFor(githubRules, url);
const rule = (match, key) => [{ name: 'test', match, key }];

test('the README GitHub rules collapse every view of a pull request or issue', () => {
    for (const family of ['pull', 'issues']) {
        const item = `https://github.com/owner/repo/${family}/12`;
        const views = [
            item,
            `${item}/`,
            `${item}/files`,
            `${item}/commits/abc123`,
            `${item}/checks?check_run_id=9`,
            `${item}?diff=split`,
        ];
        for (const view of views) {
            assert.equal(githubKeyFor(view), item, view);
        }
        // The template pins https, so the two schemes are the same item.
        assert.equal(githubKeyFor(`http://github.com/owner/repo/${family}/12`), item);
        // Different items, repos and owners stay apart.
        assert.notEqual(githubKeyFor(item), githubKeyFor(`https://github.com/owner/repo/${family}/13`));
        assert.notEqual(githubKeyFor(item), githubKeyFor(`https://github.com/owner/other/${family}/12`));
    }
    assert.notEqual(githubKeyFor('https://github.com/owner/repo/pull/12'), githubKeyFor('https://github.com/owner/repo/issues/12'));
});

test('the README GitHub rules leave everything else to plain URL keying', () => {
    // Not a pull request or issue, so no rule applies and the URL keys itself.
    for (const url of [
        'https://github.com/owner/repo',
        'https://github.com/owner/repo/settings',
        'https://github.com/owner/repo/pull',
        'https://github.com/owner/repo/issues',
        'https://github.com/owner/repo/pull/not-a-number',
        'https://github.com/owner/repo/pull/12x',
        'https://www.github.com/owner/repo/pull/12',
        'https://example.com/owner/repo/pull/12',
    ]) {
        assert.equal(githubKeyFor(url), null, url);
    }
});

test('the README GitHub rules are the GitHub examples of the options page', () => {
    // Through JSON, because objects from the vm context have its prototypes.
    assert.deepEqual(githubRules, JSON.parse(JSON.stringify(examples.slice(0, 2).map(example => example.rule))));
});

test('every example in the options page treats its two URLs as the same page', () => {
    for (const { rule, sameAs } of examples) {
        const [first, second] = sameAs.map(url => keyFor([rule], url));
        assert.notEqual(first, null, `${rule.name}: ${sameAs[0]}`);
        assert.equal(first, second, rule.name);
    }
});

test('the examples can be added together without catching each other\'s URLs', () => {
    const all = examples.map(example => example.rule);
    for (const { rule, sameAs } of examples) {
        for (const url of sameAs) {
            assert.equal(keyFor(all, url), keyFor([rule], url), `${rule.name}: ${url}`);
        }
    }
});

test('no rules means no URL is rewritten', () => {
    assert.equal(keyFor([], 'https://github.com/owner/repo/pull/12/files'), null);
});

test('literal segments have to match exactly, and the path may not have more', () => {
    const rules = rule('example.com/a/b', 'key');
    assert.equal(keyFor(rules, 'https://example.com/a/b'), 'key');
    assert.equal(keyFor(rules, 'https://example.com/a/b/'), 'key');
    assert.equal(keyFor(rules, 'https://example.com/a/b/c'), null);
    assert.equal(keyFor(rules, 'https://example.com/a'), null);
    assert.equal(keyFor(rules, 'https://example.com/a/B'), null);
});

test('{name} captures exactly one segment', () => {
    const rules = rule('example.com/{first}/{second}', 'k:{second}/{first}');
    assert.equal(keyFor(rules, 'https://example.com/one/two'), 'k:two/one');
    assert.equal(keyFor(rules, 'https://example.com/one'), null);
    assert.equal(keyFor(rules, 'https://example.com/one/two/three'), null);
});

test('a character class matches the whole segment', () => {
    const digits = rule('example.com/{n:[0-9]+}', 'n={n}');
    assert.equal(keyFor(digits, 'https://example.com/123'), 'n=123');
    assert.equal(keyFor(digits, 'https://example.com/12a'), null);
    assert.equal(keyFor(digits, 'https://example.com/a12'), null);

    const slug = rule('example.com/{s:[a-z0-9-]+}', 's={s}');
    assert.equal(keyFor(slug, 'https://example.com/my-page-2'), 's=my-page-2');
    assert.equal(keyFor(slug, 'https://example.com/My-Page'), null);

    // A negated class, and a trailing hyphen that is a literal, not a range.
    const notDigits = rule('example.com/{s:[^0-9]+}', 's={s}');
    assert.equal(keyFor(notDigits, 'https://example.com/abc'), 's=abc');
    assert.equal(keyFor(notDigits, 'https://example.com/ab1'), null);
    assert.equal(keyFor(rule('example.com/{s:[a-]+}', 's={s}'), 'https://example.com/a-a'), 's=a-a');
});

test('* matches one segment without capturing, ** matches the rest', () => {
    const one = rule('example.com/*/{id}', 'id={id}');
    assert.equal(keyFor(one, 'https://example.com/anything/7'), 'id=7');
    assert.equal(keyFor(one, 'https://example.com/7'), null);

    const rest = rule('example.com/{id}/**', 'id={id}');
    assert.equal(keyFor(rest, 'https://example.com/7'), 'id=7');
    assert.equal(keyFor(rest, 'https://example.com/7/'), 'id=7');
    assert.equal(keyFor(rest, 'https://example.com/7/a/b/c'), 'id=7');
    assert.equal(keyFor(rest, 'https://example.com'), null);
});

test('*. in a hostname matches one or more leading labels', () => {
    const rules = rule('*.example.com/{id}', 'id={id}');
    assert.equal(keyFor(rules, 'https://a.example.com/7'), 'id=7');
    assert.equal(keyFor(rules, 'https://a.b.example.com/7'), 'id=7');
    assert.equal(keyFor(rules, 'https://example.com/7'), null);
    assert.equal(keyFor(rules, 'https://notexample.com/7'), null);
    // Hostnames are compared without regard to case.
    assert.equal(keyFor(rule('EXAMPLE.com/{id}', 'id={id}'), 'https://example.com/7'), 'id=7');
});

test('the query string takes no part in matching and is dropped from the key', () => {
    const rules = rule('example.com/{id}', 'id={id}');
    assert.equal(keyFor(rules, 'https://example.com/7?a=1&b=2'), 'id=7');
    assert.equal(keyFor(rules, 'https://example.com/7#section'), 'id=7');
});

test('the first matching rule wins', () => {
    const rules = [
        { name: 'specific', match: 'example.com/a/{id}', key: 'specific:{id}' },
        { name: 'general', match: 'example.com/{section}/{id}', key: 'general:{section}/{id}' },
    ];
    assert.equal(keyFor(rules, 'https://example.com/a/1'), 'specific:1');
    assert.equal(keyFor(rules, 'https://example.com/b/1'), 'general:b/1');
});

test('a rule table that cannot be understood is rejected when it is compiled', () => {
    const rejected = [
        ['** in the middle', 'example.com/**/{id}', 'id={id}'],
        ['a key placeholder the pattern never captures', 'example.com/{id}', 'id={other}'],
        ['the same placeholder twice', 'example.com/{id}/{id}', 'id={id}'],
        ['a nameless placeholder', 'example.com/{}', 'k'],
        ['a nameless placeholder with a class', 'example.com/{:[0-9]+}', 'k'],
        ['an empty segment', 'example.com//{id}', 'id={id}'],
        ['no hostname', '/{id}', 'id={id}'],
        ['a stray brace in a segment', 'example.com/a{id}', 'k'],
        ['an unclosed brace in the key', 'example.com/{id}', 'id={id'],
        ['a class without a quantifier', 'example.com/{id:[0-9]}', 'id={id}'],
        ['a regular expression quantifier', 'example.com/{id:[0-9]*}', 'id={id}'],
        ['a counted quantifier', 'example.com/{id:[0-9]{2,4}}', 'id={id}'],
        ['a backslash escape', 'example.com/{id:\\d+}', 'id={id}'],
        ['a matcher that is not a class', 'example.com/{id:digits}', 'id={id}'],
        ['an unclosed class', 'example.com/{id:[0-9+}', 'id={id}'],
        ['an empty class', 'example.com/{id:[]+}', 'id={id}'],
        ['a backwards range', 'example.com/{id:[9-0]+}', 'id={id}'],
    ];
    for (const [why, match, key] of rejected) {
        assert.throws(() => compileUrlRules([{ name: why, match, key }]), /URL rule/, why);
    }

    for (const broken of [{ match: 'example.com/{id}' }, { key: 'k' }, { match: '', key: 'k' }, null, 'example.com/{id}', []]) {
        assert.throws(() => compileUrlRules([broken]), /URL rule/, JSON.stringify(broken));
    }
    // Rules come from storage, so the table itself may be the wrong shape.
    for (const table of [null, undefined, {}, 'rules']) {
        assert.throws(() => compileUrlRules(table), /URL rules/, JSON.stringify(table));
    }
});

test('the rejection message says which rule is wrong and why', () => {
    assert.throws(
        () => compileUrlRules([{ name: 'my rule', match: 'example.com/{id:\\d+}', key: 'id={id}' }]),
        error => error.message.includes('my rule') && error.message.includes('[0-9]+'),
    );
});
