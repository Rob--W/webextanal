"use strict";

const { isMainThread, parentPort, workerData } = require("worker_threads");
const { QueryMatcher } = require("../we-api-finder");

console.assert(!isMainThread);

const queriesAndPatterns = workerData.queriesAndPatterns;
console.assert(queriesAndPatterns instanceof Map);

parentPort.on("message", ({ sourceTexts }) => {
  const qm = new QueryMatcher(queriesAndPatterns);
  for (const sourceText of sourceTexts) {
    qm.addSource(sourceText);
  }
  qm.findMatches();
  const results = qm.getMatchedResults();
  parentPort.postMessage(results);
});
