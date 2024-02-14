"use strict";

/**
 * Helper to build queries to determine whether sourceText matches a given query
 * for API usage. This may miss non-trivial API lookups, but also report matches
 * that are not actually API usages.
 *
 * The objective is to detect patterns like this:
 * - chrome.namespace.method
 * - browser.namespace.method
 * - namespace.method
 * - alias=chrome.namespace; alias.method
 * - alias=browser.namespace; alias.method
 *
 * @see {QueryCompiler} for the usage.
 */

const RE_BEFORE = String.raw`(?:[!%&()*+,\-./:;<=>?[^{|}~\n]|^)\s*`;
const RE_AFTER = String.raw`\s*(?:[%&()*+,\-./:;<=>?[\]^{|}\n]|$)`;
const RE_DOT = String.raw`\s*\??\.\s*`;
const RE_CHROME_OR_BROWSER_DOT = String.raw`(?:chrome|browser)${RE_DOT}`;
const RE_VAR_CHAR_START = String.raw`[A-Za-z_$]`;
const RE_VAR_CHAR_END = String.raw`${RE_VAR_CHAR_START}[0-9]*`;
const RE_ALIAS_DOT = String.raw`${RE_VAR_CHAR_END}${RE_DOT}`;
const RE_RHS_AFTER = String.raw`\s*(?:[),;\]{}:]|\|\||\?\?|$|\n(?=\s*${RE_VAR_CHAR_START}))`;
//                                  ^ &/?| not included
//  also allow || ?? for cases like "= storage.sync || storage.local"
//  \n can be matched to permit ASI. To avoid too many false matches, we require
//  \n to not be in the middle of an expression (not a\n.b, yes a\nb).

/**
 * @param {string} query - The API namespace + name to search for,
 *   e.g. "tabs.create".
 * @params {Map<string,RegExp>} sharedRegExps - Collection of already-compiled
 *   regexps. Used to ensure that all RegExp with the same source string share
 *   the same RegExp object, to encourage re-use of previous results when
 *   generated patterns overlap.
 * @returns {RegExp[][]} List of condition(s). The query is deemed to match if
 *   there is a RegExp[] where each regexp in that sublist matched.
 */
function compileQuery(query, sharedRegExps) {
  function newRegExp(regexString) {
    let re = sharedRegExps.get(regexString);
    if (!re) {
      re = new RegExp(regexString);
      sharedRegExps.set(regexString, re);
    }
    return re;
  }
  function re_any(pattern) {
    // Matches the free occurrence of a JS symbol identified by pattern.
    return newRegExp(String.raw`${RE_BEFORE}(?:${pattern})${RE_AFTER}`);
  }
  function re_dot(pattern) {
    // Matches the occurrence of a JS symbol that is a property access.
    return newRegExp(String.raw`${RE_ALIAS_DOT}(?:${pattern})${RE_AFTER}`);
  }
  function re_rhs(pattern) {
    // Matches the occurrence of a JS symbol that is a right-hand-side usage,
    // e.g. as the value of an assignment. In particular, excludes
    // function invocations or dereference.
    // re_rhs true implies re_any true; re_any false implies re_rhs false.
    return newRegExp(String.raw`${RE_BEFORE}(?:${pattern})${RE_RHS_AFTER}`);
  }

  // Note: no special regexp escaping. Expected alphanum, but if the query
  // includes a regexp character somehow, why not accept it?
  const parts = query.split(".").map(p => `(?:${p})`);
  const hasRoot = query.startsWith("browser.") || query.startsWith("chrome.");

  // List of patterns. Matches if any of the patterns in the list matches fully.
  const compiledPatterns = [];
  const addRegExps = (...res) => compiledPatterns.push(res);

  // 1/x: Literal match, if possible.
  addRegExps(re_any(parts.join(RE_DOT)));

  // If no literal match, try to find aliases. The current implementation is
  // very broad and does not actually confirm whether property access uses the
  // same variable name that has the initial API definition, for simplicity.
  // We could make it more precise (especially with very common subpatterns
  // such as "get") by trying to identify the alias and its definition. But
  // that would require tracing of actual variable names and be more complex.

  if (parts.length >= 2 && !hasRoot) {
    // 2/x: First part aliased
    // tabs.create -> chrome.tabs; .create
    // storage.local.get -> chrome.storage; .local.get
    // storage.sync.onChanged.addListener -> chrome.storage; .sync.onChanged.addListener
    addRegExps(
      re_rhs(RE_CHROME_OR_BROWSER_DOT + parts[0]),
      re_dot(parts.slice(1).join(RE_DOT))
    );
  }
  if (parts.length >= 3) {
    // 3/x: First two parts aliased.
    // storage.local.get -> storage.local; .get
    // storage.sync.onChanged.addListener -> storage.sync; .onChanged.addListener
    // browser.storage.local.get -> browser.storage; .local.get
    addRegExps(
      re_rhs(parts.slice(0, 2).join(RE_DOT)),
      re_dot(parts.slice(2).join(RE_DOT))
    );
  }
  if (parts.length >= 4) {
    // 4/x: First three parts aliased.
    // storage.sync.onChanged.addListener -> storage.sync.onChanged; .addListener
    // browser.storage.local.get -> browser.storage.local; .get
    addRegExps(
      re_rhs(parts.slice(0, 3).join(RE_DOT)),
      re_dot(parts.slice(3).join(RE_DOT))
    );
  }
  return compiledPatterns;
}

/***
 * Usage:
 *
 * const qc = new QueryCompiler();
 * qc.addQuery("tabs.create");
 * qc.addQuery("storage.local.get");
 * qc.addQuery("storage.sync.get");
 * const qm = qc.newQueryMatcher();
 * qm.addSource(" ... JS source code of extension ... ");
 * qm.addSource(" ... JS source code of extension ... ");
 * qm.findMatches();
 * console.log(qm.getMatchedResults()); // Set with matched queries
 */
class QueryCompiler {
  constructor() {
    this.queriesAndPatterns = new Map();
    this.sharedRegExps = new Map();
  }
  addQuery(query) {
    if (this.queriesAndPatterns.has(query)) {
      console.warn(`Ignoring duplicate query: ${query}`);
      return;
    }
    const compiledPatterns = compileQuery(query, this.sharedRegExps);
    this.queriesAndPatterns.set(query, compiledPatterns);
  }
  newQueryMatcher() {
    return new QueryMatcher(this.queriesAndPatterns);
  }
}

class QueryMatcher {
  constructor(queriesAndPatterns) {
    this.queriesAndPatterns = queriesAndPatterns;
    this.matchedQueries = new Set();
    this.sourceTexts = new Set();
  }
  addSource(sourceText) {
    // NOTE: comment stripping may fail, when // or /* */ is in a string, etc.
    const sourceTextWithoutComments =
      sourceText
      .replace(/(?<!:)\/\/.*/g, "") // Single-line comments, excluding URLs.
      .replace(/\/\*.*?\*\//sg, ""); // Multi-line comments
    this.sourceTexts.add(sourceText);
    this.sourceTexts.add(sourceTextWithoutComments);
  }
  findMatches() {
    // Relying on sharedRegExps to ensure that every pattern with the same
    // pattern/serialization has the same RegExp instance.
    const sharedRegExpResults = new Map();
    const sourceTexts = Array.from(this.sourceTexts);
    function testMatch(regex) {
      let res = sharedRegExpResults.get(regex);
      if (res === undefined) {
        res = sourceTexts.some(sourceText => regex.test(sourceText));
        sharedRegExpResults.set(regex, res);
      }
      return res;
    }
    for (const [query, compiledPatterns] of this.queriesAndPatterns) {
      if (this.matchedQueries.has(query)) {
        // Already found in a previous call to findMatches.
        continue;
      }
      if (compiledPatterns.some(ps => ps.every(p => testMatch(p)))) {
        this.matchedQueries.add(query);
      }
    }
  }
  getMatchedResults() {
    // TODO: Consider using some order as this.queriesAndPatterns.keys().
    return this.matchedQueries;
  }
}

exports.QueryCompiler = QueryCompiler;
