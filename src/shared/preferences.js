import compat from './compat.js';

export default new class {
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
     */
    async set(key, value) {
        return await compat.storage.local.set({[key]: value});
    }

    /**
     * Deletes key from storage. `get(key)` will return fallback value afterwards
     */
    async delete(key) {
        return await compat.storage.local.remove(key);
    }

    /**
     * Listen to preference changes. I think this only triggers if the change
     * is made outside of this script (i.e. in popup.html or options.html)
     */
    listen(key, callback) {
        compat.storage.local.onChanged.addListener(changes => {
            if (key in changes)
                callback(changes[key])
        });
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
            }
        });

        Object.assign(view, defaults);

        compat.storage.local.get(Object.keys(defaults)).then(result => {
            Object.assign(view, result);
            listeners.forEach(listener => listener(result));
        });

        compat.storage.local.onChanged.addListener(changes => {
            const diff = {};

            for (let key of defaults)
                if (key in changes && changes[key].newValue !== view[key])
                    diff[key] = changes[key].newValue;

            if (Object.keys(diff).length === 0)
                return;

            Object.assign(view, diff);
            listeners.forEach(listener => listener(diff));
        })

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