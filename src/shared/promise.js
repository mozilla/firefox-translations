/**
 * Promise class, but with a progress notification. Useful for things like
 * downloads where there is information about progress.
 */
export class PromiseWithProgress extends Promise {
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
