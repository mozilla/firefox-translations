/**
 * Very, very rudimentary YAML parser. But sufficient for config.yml files!
 * Notable: does not do nested objects.
 */
class YAML {
    static parse(yaml) {
        const out = {};

        yaml.split('\n').reduce((key, line, i) => {
            let match;
            if (match = line.match(/^\s*-\s+(.+?)$/)) {
                if (!Array.isArray(out[key]))
                    out[key] = out[key].trim() ? [out[key]] : [];
                out[key].push(match[1].trim());
            }
            else if (match = line.match(/^\s*([A-Za-z0-9_][A-Za-z0-9_-]*):\s*(.*)$/)) {
                key = match[1];
                out[key] = match[2].trim();
            }
            else if (!line.trim()) {
                // whitespace, ignore
            }
            else {
                throw Error(`Could not parse line ${i+1}: "${line}"`);
            }
            return key;
        }, null);

        return out;
    }

    static stringify(data) {
        return Object.entries(data).reduce((str, [key, value]) => {
            let valstr = '';
            if (Array.isArray(value))
                valstr = value.map(val => `\n  - ${val}`).join('');
            else if (typeof value === 'number' || typeof value === 'boolean' || value.match(/^\d*(\.\d+)?$/))
                valstr = `${value}`;
            else
                valstr = `${value}`; // Quote?

            return `${str}${key}: ${valstr}\n`;
        }, '');
    }
}