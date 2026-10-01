// URL matching rules: the site-specific half of duplicate detection, kept as
// data so that teaching the extension about a site means adding a rule in the
// options page rather than writing code. Nothing in here touches the chrome.* APIs: the
// service worker loads this file with importScripts(), and url-rules.test.js
// runs the same functions with plain node.
//
// Each rule has a `match` pattern and a `key` template. A URL that matches the
// pattern is keyed by the expanded template, so two tabs whose URLs differ only
// in the parts the template leaves out are duplicates of each other.
//
// The pattern language is deliberately smaller than regular expressions:
//
//   text              a literal segment, which must match exactly
//   {name}            captures exactly one non-empty segment
//   {name:[0-9]+}     the same, but only a segment of digits
//   *                 exactly one segment, not captured
//   **                zero or more remaining segments; only as the last part
//   *.example.com     a hostname with one or more leading labels
//
// A character class applies to the whole segment, and `+` - one or more - is
// the only quantifier there is, so matching a segment is a membership test per
// character. That is the whole reason this file contains no RegExp: there is
// nothing to backtrack over. Anything else that regular expressions would allow
// (`\d`, `.`, `*`, `?`, `{2,4}`, `|`, groups) is rejected when the rules are
// compiled, rather than being quietly misread.
//
// Patterns are matched against the hostname followed by the path, so the scheme
// and the query string play no part in matching. Whatever the template leaves
// out is dropped from the key: that is what collapses every view of a pull
// request onto the pull request itself.
//
// No rules ship with the extension. They are written in the options page, kept
// in chrome.storage.local as a JSON array of { name, match, key } objects, and
// compiled by the service worker; the README has rules for GitHub to start from.

// Parses `[0-9]+` and friends into the ranges a segment's characters have to
// fall in. Everything this does not understand throws, because a rule table is
// written by hand and read rarely: a typo should be refused when the rules are
// saved instead of silently mis-keying tabs for months.
function parseCharacterClass(source, where) {
    if (!source.startsWith('[')) {
        throw new Error(`${where}: a placeholder matcher has to be a character class such as [0-9]+, not ${JSON.stringify(source)}`);
    }
    const close = source.indexOf(']');
    if (close === -1) {
        throw new Error(`${where}: the character class ${JSON.stringify(source)} is missing its closing ]`);
    }
    const quantifier = source.slice(close + 1);
    if (quantifier !== '+') {
        throw new Error(`${where}: a character class has to be followed by + (one or more), not ${JSON.stringify(quantifier)}. A class always matches the whole segment.`);
    }

    let body = source.slice(1, close);
    const negated = body.startsWith('^');
    if (negated) {
        body = body.slice(1);
    }
    if (body === '') {
        throw new Error(`${where}: the character class in ${JSON.stringify(source)} is empty`);
    }

    const ranges = [];
    for (let i = 0; i < body.length; i++) {
        if (body[i] === '\\') {
            throw new Error(`${where}: backslash escapes such as \\d are not supported in ${JSON.stringify(source)}; spell the characters out, as in [0-9]+`);
        }
        // `a-z` is a range; a `-` with nothing after it is just a hyphen.
        if (body[i + 1] === '-' && i + 2 < body.length) {
            const [from, to] = [body[i], body[i + 2]];
            if (from > to) {
                throw new Error(`${where}: the range ${from}-${to} in ${JSON.stringify(source)} runs backwards`);
            }
            ranges.push([from, to]);
            i += 2;
        } else {
            ranges.push([body[i], body[i]]);
        }
    }
    return { negated, ranges };
}

function characterClassMatches(characterClass, segment) {
    if (segment.length === 0) return false;
    for (const character of segment) {
        const inClass = characterClass.ranges.some(([from, to]) => character >= from && character <= to);
        if (inClass === characterClass.negated) return false;
    }
    return true;
}

// `{name}` or `{name:[0-9]+}`, or null when the token is not a placeholder.
function parsePlaceholder(token, where) {
    if (!token.startsWith('{') || !token.endsWith('}')) {
        if (token.includes('{') || token.includes('}')) {
            throw new Error(`${where}: ${JSON.stringify(token)} looks like a placeholder but is not wrapped in { }`);
        }
        return null;
    }
    const body = token.slice(1, -1);
    const colon = body.indexOf(':');
    const name = colon === -1 ? body : body.slice(0, colon);
    if (name === '') {
        throw new Error(`${where}: ${token} has no placeholder name`);
    }
    return {
        name,
        characterClass: colon === -1 ? null : parseCharacterClass(body.slice(colon + 1), where),
    };
}

// The `{name}`s a key template wants filled in.
function keyTemplatePlaceholders(template, where) {
    const names = [];
    for (let i = 0; i < template.length; i++) {
        if (template[i] !== '{') continue;
        const close = template.indexOf('}', i);
        if (close === -1) {
            throw new Error(`${where}: the key ${JSON.stringify(template)} has a { without a matching }`);
        }
        names.push(template.slice(i + 1, close));
        i = close;
    }
    return names;
}

// Turns a rule table into something matchable, and rejects every rule it
// cannot make sense of. The table comes from storage, so its shape is checked
// too rather than trusted.
function compileUrlRules(rules) {
    if (!Array.isArray(rules)) {
        throw new Error('URL rules: the rules have to be a JSON array, as in [{ "name": ..., "match": ..., "key": ... }]');
    }
    return rules.map((rule, index) => {
        if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) {
            throw new Error(`URL rule #${index + 1}: a rule has to be an object with match and key`);
        }
        const where = `URL rule ${JSON.stringify(rule.name ?? rule.match ?? `#${index + 1}`)}`;
        if (typeof rule.match !== 'string' || typeof rule.key !== 'string' || !rule.match || !rule.key) {
            throw new Error(`${where}: both match and key are required, as strings`);
        }

        const [hostname, ...parts] = rule.match.split('/');
        if (!hostname) {
            throw new Error(`${where}: the pattern has to start with a hostname, as in github.com/{owner}`);
        }

        const captured = new Set();
        const segments = parts.map((token, index) => {
            if (token === '') {
                throw new Error(`${where}: the pattern has an empty segment - two slashes in a row, or a trailing slash`);
            }
            if (token === '**') {
                if (index !== parts.length - 1) {
                    throw new Error(`${where}: ** is only allowed as the last part of a pattern`);
                }
                return { kind: 'rest' };
            }
            if (token === '*') {
                return { kind: 'any' };
            }
            const placeholder = parsePlaceholder(token, where);
            if (!placeholder) {
                return { kind: 'literal', text: token };
            }
            if (captured.has(placeholder.name)) {
                throw new Error(`${where}: {${placeholder.name}} is captured twice`);
            }
            captured.add(placeholder.name);
            return { kind: 'capture', ...placeholder };
        });

        for (const name of keyTemplatePlaceholders(rule.key, where)) {
            if (!captured.has(name)) {
                throw new Error(`${where}: the key uses {${name}}, which the pattern never captures`);
            }
        }

        return { name: rule.name, hostname: hostname.toLowerCase(), segments, key: rule.key };
    });
}

// `example.com` matches itself; `*.example.com` matches one or more leading
// labels, so `a.example.com` and `a.b.example.com` but not `example.com`.
function hostnameMatches(pattern, hostname) {
    if (pattern === hostname) return true;
    if (!pattern.startsWith('*.')) return false;
    const suffix = pattern.slice(1);
    return hostname.length > suffix.length && hostname.endsWith(suffix);
}

// The placeholders a compiled rule captures from a URL, or null when the rule
// does not apply. `**` is only ever last, so this is one pass with no
// backtracking.
function matchUrlRule(rule, hostname, pathname) {
    if (!hostnameMatches(rule.hostname, hostname)) return null;

    const segments = pathname.split('/').filter(segment => segment !== '');
    const captures = {};
    for (let i = 0; i < rule.segments.length; i++) {
        const expected = rule.segments[i];
        if (expected.kind === 'rest') return captures;
        if (i >= segments.length) return null;
        const segment = segments[i];
        if (expected.kind === 'literal') {
            if (expected.text !== segment) return null;
        } else if (expected.kind === 'capture') {
            if (expected.characterClass) {
                if (!characterClassMatches(expected.characterClass, segment)) return null;
            } else if (segment.length === 0) {
                return null;
            }
            captures[expected.name] = segment;
        }
    }
    // Without a trailing `**` the path may not have segments left over.
    return rule.segments.length === segments.length ? captures : null;
}

function expandKeyTemplate(template, captures) {
    let key = '';
    for (let i = 0; i < template.length; i++) {
        if (template[i] !== '{') {
            key += template[i];
            continue;
        }
        const close = template.indexOf('}', i);
        key += captures[template.slice(i + 1, close)];
        i = close;
    }
    return key;
}

// The key for a parsed URL according to the first of the compiled rules that
// matches it, or null when none does and the URL should be keyed by itself.
function applyUrlRules(parsed, rules) {
    const hostname = parsed.hostname.toLowerCase();
    for (const rule of rules) {
        const captures = matchUrlRule(rule, hostname, parsed.pathname);
        if (captures !== null) {
            return expandKeyTemplate(rule.key, captures);
        }
    }
    return null;
}
