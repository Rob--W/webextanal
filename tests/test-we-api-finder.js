#!/usr/bin/env node
"use strict";

const assert = require("node:assert");
const test = require("node:test");
const weApiFinder = require("../helpers/we-api-finder");
const QueryCompiler = weApiFinder.QueryCompiler;

test("QueryCompiler and QueryMatcher", () => {
  const qc = new QueryCompiler();
  qc.addQuery("tabs.create");
  qc.addQuery("storage.local.get");
  qc.addQuery("storage.sync.onChanged.addListener");

  const qm = qc.newQueryMatcher();
  qm.addSource(" ... JS source code of extension ... ");
  qm.addSource(" ... JS source code of extension ... ");

  qm.findMatches();
  const results = qm.getMatchedResults();
  assert.deepStrictEqual(results, new Set()); // No matches
  qm.addSource(" ... browser.tabs.create({}) ...");
  qm.findMatches();
  // To avoid unnecessary copies, the return value is a reference.
  assert.strictEqual(
    qm.getMatchedResults(),
    results,
    "getMatchedResults()'s return value is a direct reference to results"
  );
  assert.deepStrictEqual(new Set(["tabs.create"]), results);

  qm.addSource(" ... browser.tabs.create({}) ... number two");
  qm.findMatches();
  assert.deepStrictEqual(new Set(["tabs.create"]), results); // Still one match.

  qm.addSource(" ... chrome.storage.local.get({}) ...");
  qm.findMatches();
  assert.deepStrictEqual(
    new Set(["tabs.create", "storage.local.get"]),
    results
  );

  // New query, also two matches.
  const qm2 = qc.newQueryMatcher();
  qm2.addSource(" ... storage.local.get; storage.sync.onChanged.addListener");
  qm2.findMatches();
  assert.deepStrictEqual(
    new Set(["storage.local.get", "storage.sync.onChanged.addListener"]),
    qm2.getMatchedResults()
  );
});

function assertQueryMatch(query, sourceText) {
  const qc = new QueryCompiler();
  qc.addQuery(query);
  const qm = qc.newQueryMatcher();
  qm.addSource(sourceText);
  qm.findMatches();
  assert.deepStrictEqual(new Set([query]), qm.getMatchedResults());
}
function assertQueryNotMatch(query, sourceText) {
  const qc = new QueryCompiler();
  qc.addQuery(query);
  const qm = qc.newQueryMatcher();
  qm.findMatches(sourceText);
  assert.deepStrictEqual(new Set(), qm.getMatchedResults());
}
test("findMatches: simple search", () => {
  assertQueryMatch("test", "test");
  assertQueryMatch("test", "nottest yes(test)");
  assertQueryNotMatch("test", "");
  assertQueryNotMatch("test", "nottest");
  assertQueryNotMatch("test", "testnot");
  assertQueryNotMatch("test", "nottestnot");

  assertQueryMatch("ns.api", "ns.api");
  // Spaces around
  assertQueryMatch("ns.api", "ns .api");
  assertQueryMatch("ns.api", "ns. api");
  assertQueryMatch("ns.api", "ns\n.\napi");
  assertQueryNotMatch("ns.api", "ns\n \napi");
  // Optional chaining
  assertQueryMatch("ns.api", "ns?.api");
  assertQueryNotMatch("ns.api", "ns??.api");

  assertQueryMatch("a.b.c.d.e", "a?.b.c?.\nd.e");
});

test("findMatches: aliases", () => {
  // Two is too short, we're looking for extension APIs only.
  assertQueryNotMatch("ns.api", "alias=ns; alias.api");
  assertQueryNotMatch("ns.api", "alias=other.ns; alias.api");
  assertQueryMatch("ns.api", "alias=chrome.ns; alias.api");
  assertQueryMatch("ns.api", "alias=browser.ns; alias.api");
  assertQueryMatch("ns.api", "alias=browser.ns; canbesomethingelse.api");
  assertQueryMatch("ns.api", "alias=browser.ns;\nxx\nsomethingelse.api");
  assertQueryMatch("ns.api", "alias=browser.ns \nxx\nsomethingelse.api");
  assertQueryNotMatch("ns.api", "alias=browser.ns; alias.apinot");
  assertQueryNotMatch("ns.api", "alias=browser.nsnot; alias.api");
  assertQueryNotMatch("ns.api", "alias=chrome.ns; #.api"); // # is not a char

  // browser and chrome are considered aliases, unless the query starts with it.
  assertQueryNotMatch("browser.api", "alias=browser.browser; alias.api");
  assertQueryNotMatch("browser.api", "alias=chrome.browser; alias.api");
  assertQueryNotMatch("chrome.api", "alias=browser.browser; alias.api");
  assertQueryNotMatch("chrome.api", "alias=chrome.browser; alias.api");
  assertQueryNotMatch("chrome.api", "browser.api");
  assertQueryNotMatch("browser.api", "chrome.api");
  assertQueryMatch("browser.api", "browser.api");
  assertQueryMatch("chrome.api", "chrome.api");

  // Three is sufficiently long that chrome/browser is optional in namespace,
  // if the namespace consists of at least two parts with dot.
  assertQueryNotMatch("ns.api.third", "x=ns; x.api.third");
  assertQueryNotMatch("ns.api.third", "x=other.ns; x.api.third");
  assertQueryMatch("ns.api.third", "x=other.ns.api; x.third");
  assertQueryMatch("ns.api.third", "x=chrome.ns; y.api.third");
  assertQueryMatch("ns.api.third", "x=browser.ns; y.api.third");
  assertQueryNotMatch("ns.api.fo.ur", "x=ns; x.api.fo.ur");
  assertQueryNotMatch("ns.api.fo.ur", "x=other.ns; x.api.fo.ur");
  assertQueryMatch("ns.api.fo.ur", "x=other.ns.api; x.fo.ur");
  assertQueryMatch("ns.api.fo.ur", "x=chrome.ns; y.api.fo.ur");
  assertQueryMatch("ns.api.fo.ur", "x=browser.ns; y.api.fo.ur");
  assertQueryMatch("ns.api.fo.ur", "x=ns.api.fo; y.ur");
  assertQueryMatch("ns.api.fo.ur", "x=ns.api; y.fo.ur");
  assertQueryMatch("ns.api.fo.ur", "x=ns.api.fo; y.ur");
  // Three aliases are not matched, due to concern over noise.
  assertQueryNotMatch("ns.api.third", "x=chrome.ns; y=x.api; y.third");
});

test("findMatches: comments", () => {
  // Matches calls within comment
  assertQueryMatch("ns.api", "// ns.api");
  assertQueryMatch("ns.api", "// alias=browser.ns;\n//alias.api");
  assertQueryMatch("ns.api", "/* ns.api *.");
  assertQueryMatch("ns.api", "/* alias=browser.ns;\n//alias.api */");
  assertQueryMatch("ns.api", "ns/**/./*x*/api");
  assertQueryMatch("ns.api", "ns//comment\n.api");
  assertQueryMatch("ns.api", "foo + 'http://foo' + ns/*x*/.api");
  assertQueryMatch("ns.api.third", "ns//comment\n.api//com\n.//ment\nthird");
});
