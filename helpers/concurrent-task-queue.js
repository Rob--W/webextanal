"use strict";

class ConcurrentTaskQueue {
    constructor(max) {
        this.max = max; // Maximum number of concurrent tasks.
        this.size = 0;
        this.tasks = [];
    }
    async queueTask(runTaskCallback) {
        return new Promise((resolve, reject) => {
            this.tasks.push({ resolve, reject, runTaskCallback });
            this._runNextTask();
        });
    }
    async _runNextTask() {
        while (this.size < this.max && this.tasks.length) {
            const task = this.tasks.shift();
            ++this.size;
            try {
                task.resolve(await task.runTaskCallback());
            } catch (e) {
                task.reject(e);
            }
            --this.size;
        }
    }
}

module.exports = ConcurrentTaskQueue;
