import compat from './compat.js';

export default new class {
    #listeners;

    constructor() {
        this.#listeners = new Set();
    }
    /**
     * Get preference from storage, or return `fallback` if there was no
     * preference.
     */
    async get(key, fallback) {
        const response = await compat.storage.local.get(key);
        return response[key] !== undefined ? response[key] : fallback;
    }

    /**
     * Changes preferences. Will notify other pages about the change.
     * @param {String} key
     * @param {Object} value
     * @param {{silent:Boolean}?} options
     */
    async set(key, value, options) {
        console.log('[preferences] set', key, 'to', value);
        await compat.storage.local.set({[key]: value});
        
        // Notify local listeners with the same sort event that onChanged gets
        if (!options?.silent)
            this.#listeners.forEach(callback => callback({[key]: {newValue: value}}, 'local'));
    }

    /**
     * Deletes key from storage. `get(key)` will return fallback value afterwards
     */
    async delete(key) {
        return await compat.storage.local.remove(key);
    }

    /**
     * Listen to preference changes.
     * @return {() => null} callback to stop listening
     */
    listen(key, callback) {
        const listener = (changes, area) => {
            if (area === 'local' && key in changes)
                callback(changes[key].newValue)
        };

        compat.storage.onChanged.addListener(listener);
        this.#listeners.add(listener);

        return () => {
            compat.storage.onChanged.removeListener(listener);
            this.#listeners.delete(listener);
        };
    }

    /**
     * get() + listen() in an easy package.
     * @param {String} key
     * @param {(Object) => null} callback called with value and when value changes
     * @return {() => null} callback to stop listening
     */
    bind(key, callback, options) {
        this.get(key, options?.default).then(value => callback(value));
        return this.listen(key, callback);
    }

    /**
     * Create a (not async) view of the preferences that's faster to access
     * frequently. Will be kept in sync. Use addListener() to know when it
     * changes.
     */
    view(defaults) {
        const listeners = new Set();

        const view = Object.create({
            addListener(callback) {
                listeners.add(callback);
            },
            delete: () => {
                compat.storage.onChanged.removeListeners(listener);
                this.#listeners.delete(listener);
            }
        });

        Object.assign(view, defaults);

        compat.storage.local.get(Object.keys(defaults)).then(result => {
            Object.assign(view, result);
            listeners.forEach(listener => listener(result));
        });

        function listener(changes, area) {
            if (area !== 'local')
                return;

            const diff = {};

            for (let key of Object.keys(defaults))
                if (key in changes && changes[key].newValue !== view[key])
                    diff[key] = changes[key].newValue;

            if (Object.keys(diff).length === 0)
                return;

            Object.assign(view, diff);
            listeners.forEach(listener => listener(diff));
        }

        // Listen to changes from outside this context
        compat.storage.onChanged.addListener(listener);

        // Listen to changes in the current context
        this.#listeners.add(listener);

        return new Proxy(view, {
            get(...args) {
                return Reflect.get(...args)
            },

            set(...args) {
                throw new Error('Preference view is read-only')
            }
        })
    }
};