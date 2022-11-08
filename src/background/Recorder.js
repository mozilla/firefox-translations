/**
 * A record can be used to record all translation messages send to the
 * translation backend. Useful for debugging & benchmarking.
 */
export default class Recorder {
    #pages;

    constructor() {
        this.#pages = new Map();
    }

    record({from, text, session: {url}}) {
        // Unique per page url
        if (!this.#pages.has(url))
            this.#pages.set(url, {
                url,
                from,
                texts: [],
            });

        // TODO: we assume everything is HTML or not, `html` is ignored.
        this.#pages.get(url).texts.push(text);
    }

    get size() {
        return this.#pages.size;
    }

    clear() {
        this.#pages.clear();
    }

    exportAXML() {
        const root = document.implementation.createDocument('', '', null);
        const dataset = root.createElement('dataset');

        this.#pages.forEach(page => {
            const doc = root.createElement('doc');
            doc.setAttribute('origlang', page.from);
            doc.setAttribute('href', page.url);

            const src = root.createElement('src');
            src.setAttribute('lang', page.from);

            page.texts.forEach((text, i) => {
                const p = root.createElement('p');
                
                const seg = root.createElement('seg');
                seg.setAttribute('id', i + 1);

                seg.appendChild(root.createTextNode(text));
                p.appendChild(seg);

                src.appendChild(p);
            });

            doc.appendChild(src);
            dataset.appendChild(doc);
        });

        root.appendChild(dataset);

        const serializer = new XMLSerializer();
        const xml = serializer.serializeToString(root);
        return new Blob([xml], {type: 'application/xml'});
    }
}
