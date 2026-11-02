// Settings contract: every gschema key must be wired through both processes.
//
// AGENTS.md: "Adding a setting means four edits: schema XML, key constant in
// common.js, read + changed:: case in extension.js, Adw row in prefs.js."
// extension.js and prefs.js share nothing but the schema (and common.js), so a
// half-finished setting fails silently at runtime. This fails loudly instead.
//
// Run from the repository root: gjs -m tests/test-settings-contract.js

import GLib from 'gi://GLib';
import System from 'system';

const SCHEMA = 'schemas/org.gnome.shell.extensions.public-ip-address.gschema.xml';

function read(path) {
    const [ok, bytes] = GLib.file_get_contents(path);
    if (!ok)
        throw new Error(`cannot read ${path} (run make from the repository root)`);
    return new TextDecoder().decode(bytes);
}

const escape = s => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

const schema = read(SCHEMA);
const common = read('common.js');
const extension = read('extension.js');
const prefs = read('prefs.js');

const keys = [...schema.matchAll(/<key\s+[^>]*name="([^"]+)"/g)].map(m => m[1]);
if (keys.length === 0)
    throw new Error(`no <key> entries found in ${SCHEMA}`);

const failures = [];

for (const key of keys) {
    const declared = common.match(
        new RegExp(`export\\s+const\\s+(\\w+)\\s*=\\s*'${escape(key)}';`)
    );
    if (!declared) {
        failures.push(`${key}: no exported key constant in common.js`);
        continue;
    }

    const name = declared[1];

    if (!new RegExp(`case\\s+${name}\\s*:`).test(extension))
        failures.push(`${key}: ${name} has no case in the changed:: handler`);

    if (!new RegExp(`get_\\w+\\(\\s*${name}\\s*\\)`).test(extension))
        failures.push(`${key}: ${name} is never read from GSettings`);

    // The declaration alone is not a row: prefs.js must bind, read or write it
    if (!new RegExp(`settings\\.(bind|get_\\w+|set_\\w+)\\(\\s*${name}\\b`).test(prefs))
        failures.push(`${key}: ${name} is not bound, read or written in prefs.js`);
}

if (failures.length > 0) {
    for (const failure of failures)
        printerr(`FAIL ${failure}`);
    printerr(`settings contract: ${failures.length} failure(s)`);
    System.exit(1);
}

print(`settings contract: ${keys.length} keys, ${keys.length * 4} checks passed`);
