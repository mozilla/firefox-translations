/**
 * little helper that we can use to make sure our JavaScript is executed before
 * any of the page's JavaScript.
 */
function insertScript(text) {
    let parent = document.documentElement,
    script = document.createElement('script');

    script.text = text;
    script.async = false;

    parent.insertBefore(script, parent.firstChild);
    parent.removeChild(script);
};

/**
 * replacement for MutationObserver that can be reset by calling
 * the global functino `$BergamotResetMutationObservers()`. This way we
 * can change the page, and then reset all mutation observers to not be
 * notified about those changes.
 */
insertScript(`
(function() {

const OriginalMutationObserver = window.MutationObserver;

const observers = [];

window.MutationObserver = class MutationObserver extends OriginalMutationObserver {
    constructor(callback) {
        super(callback);
    }

    observe(...args) {
        super.observe(...args);
        observers.push(new WeakRef(this));
    }
}

window.$BergamotResetMutationObservers = function() {
    // reset any of the observers still alive. Filter out those that are not.
    observers.splice(0, observers.length, ...observers.filter(observerRef => {
        const observer = observerRef.deref();
        if (observer === undefined) return false;
        observer.takeRecords();
        return true;
    }));
};

})();
`);
