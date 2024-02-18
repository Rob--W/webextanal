"use strict";

const os = require("os");
const path = require("path");
const { Worker } = require("worker_threads");
const weApiFinder = require("../we-api-finder");

const workerSrc = path.join(__dirname, "worker.js");
const kTaskResolver = Symbol("kTaskResolver");

function getNumThreads() {
  // Allow override in case there is somehow a need to not utilize all cores.
  if (process.env.WE_API_FINDER_NUM_THREADS) {
    return parseInt(process.env.WE_API_FINDER_NUM_THREADS);
  }
  try {
    return os.availableParallelism();
  } catch {
    // os.availableParallelism() is Node v18.14.0+. Fall back
    return os.cpus().length || 1;
  }
}

class QueryMatcherWorkerPool {
  constructor(queriesAndPatterns) {
    this.queriesAndPatterns = queriesAndPatterns;
    this.numThreads = getNumThreads();
    this.workers = [];
    this.idleWorkers = [];
    this.taskQueue = [];
  }

  getFreeWorker() {
    if (this.idleWorkers.length) {
      return this.idleWorkers.shift();
    }
    if (this.workers.length < this.numThreads) {
      const workerData = { queriesAndPatterns: this.queriesAndPatterns };
      const worker = new Worker(workerSrc, { workerData });
      worker.on("message", result => {
        worker[kTaskResolver](result);
        this.idleWorkers.push(worker);
        this._runNextTask();
      });
      worker.on("error", err => {
        worker[kTaskResolver](Promise.reject(err));
        // Note: Not pushed into idleWorkers since it has been terminated.
      });
      this.workers.push(worker);
      return worker;
    }
    return null;
  }

  queryResultsForSourceTexts(sourceTexts) {
    return new Promise((resolve) => {
      this.taskQueue.push({ resolve, sourceTexts });
      this._runNextTask();
    });
  }

  _runNextTask() {
    while (this.taskQueue.length) {
      let worker = this.getFreeWorker();
      if (!worker) {
        // Wait until a free worker is available before retrying.
        break;
      }
      let task = this.taskQueue.shift();
      worker[kTaskResolver] = task.resolve;
      worker.postMessage({ sourceTexts: task.sourceTexts });
    }
  }

  terminateAllWorkers() {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers.length = 0;
    this.idleWorkers.length = 0;
  }
}

// This QueryCompiler has the same interface as weApiFinder.QueryCompiler,
// except the actual query work is offloaded to a separate thread.
class QueryCompiler {
  constructor() {
    this.qcInternal = new weApiFinder.QueryCompiler();
    this.workerPool = null;
  }
  addQuery(query) {
    if (this.workerPool) {
      throw new Error("addQuery cannot be called after newQueryMatcher!");
    }
    return this.qcInternal.addQuery(query);
  }

  // This newQueryMatcher method replaces weApiFinder.QueryCompiler: returns a
  // matcher that performs the equivalent work off the main thread.
  newQueryMatcher() {
    if (!this.workerPool) {
      this.workerPool = new QueryMatcherWorkerPool(
        // queriesAndPatterns is populated by addQuery.
        this.qcInternal.queriesAndPatterns
      );
    }
    return new AsyncQueryMatcher(this.workerPool);
  }

  destroy() {
    if (this.workerPool) {
      this.workerPool.terminateAllWorkers();
      this.workerPool = null;
    }
  }
}

class AsyncQueryMatcher {
  constructor(workerPool) {
    this.workerPool = workerPool;
    this.matchedQueries = null;
    this.sourceTexts = new Set();
  }
  addSource(sourceText) {
    this.sourceTexts.add(sourceText);
  }
  async findMatches() {
    this.matchedQueries = await this.workerPool.queryResultsForSourceTexts(
      this.sourceTexts
    );
  }
  getMatchedResults() {
    if (!this.matchedQueries) {
      throw new Error("Attempted to get results before findMatches resolved");
    }
    return this.matchedQueries;
  }
}

exports.QueryCompiler = QueryCompiler;
