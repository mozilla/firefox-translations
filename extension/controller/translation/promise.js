/**
 * Promise class, but with a progress notification. Useful for things like
 * donwloads where there is information about progress.
 */
class PromiseWithProgress extends Promise {
    #listeners;

    constructor(factory) {
        super((accept, reject) => {
            factory(accept, reject, (progress) => {
                this.#listeners.forEach(listener => listener(progress));
            });
        });
        this.#listeners = new Set();
    }

    addProgressListener(callback) {
        this.#listeners.add(callback);
    }
}
