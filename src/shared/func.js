/**
 * Little wrapper to delay a promise to be made only once it is first awaited on
 * @param {() => Promise<T>} factory function that creates a promise
 * @returns {Promise<T>} promise that only calls `factory` when `then()` is first called
 */
export function lazy(factory) {
    let promise = null;

    return {
        get instantiated() {
            return promise !== null;
        },

        then(...args) {
            // Ask for the actual promise
            if (promise === null) {
                promise = factory();
            
                if (typeof promise?.then !== 'function')
                    throw new TypeError('factory() did not return a promise-like object');
            }

            // Forward the current call to the promise
            return promise.then(...args);
        }
    };
}

/**
 * Array.prototype.map, but with a twist: the functor returns an iterator
 * (or more usefully) a generator, it will then add each of those elements.
 * @param {Iterable<X>} iterable
 * @param {(item:X) => Iterable<Y>} functor
 * @returns {Iterable<Y>}
 */
export function *flatten(iterable, functor) {
    for (let item of iterable)
        yield* functor(item);
}

/**
 * `product([a,b], [1,2]) == [[a,1], [a,2], [b,1], [b,2]]`
 * @param {Iterable<X>} as
 * @param {Iterable<Y>} bs
 * @returns {Iterable<[X,Y]>} pairs of elements of `as` and `bs`
 */
export function *product(as, bs) {
    for (let a of as)
        for (let b of bs)
            yield [a, b];
}

/**
 * Take the first element from anything that can be iterated over. Like arr[0]
 * or iterable[Symbol.iterator].next().value. If the iterator is empty, throw.
 * @param {Iterable<T>} iterable list of elements containing 1 or more values
 * @returns {T} first element of `iterable`
 */
export function first(iterable) {
    for (let item of iterable)
        return item;
    throw new RangeError('Iterable is empty');
}

/**
 * Returns a set that is the intersection of two iterables
 * @param {Iterable<T>} a first list of elements
 * @param {Iterable<T>} b second list of elements
 * @returns {Set<T>} set of elements both in `a` and `b`
 */
export function intersect(a, b) {
    const bSet = new Set(b);
    return new Set(Array.from(a).filter(item => bSet.has(item)));
}

/**
 * Deduplicate entries in a list based on `key` and for each key sorting them
 * using `sort`.
 * @param {Iterable<T>} iterable
 * @param {{
 *   key: (item:T) => any,
 *   sort: (left:T, right:T) => Number
 * }} options
 * @returns {Iterable<T>} deduplicated list
 */
export function *deduplicate(iterable, {key, sort}) {
    const map = new Map();
    for (let item of iterable) {
        if (map.has(key(item)))
            map.get(key(item)).push(item);
        else
            map.set(key(item), [item])
    }

    for (let [_, items] of map) {
        items.sort(sort);
        yield first(items);
    }
}
