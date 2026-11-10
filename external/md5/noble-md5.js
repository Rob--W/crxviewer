/**
 * (c) 2026 Subham Mahesh
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Entry point for the MD5 implementation used by lib/modern-crypto.js.
 * Bundled by `node make.js bundles` into src/lib/noble-md5.js, which exposes
 * the global `NobleMD5`. Browsers do not offer MD5 in crypto.subtle, so it
 * comes from @noble/hashes (MIT license); the SHA hashes use crypto.subtle.
 */

import {md5} from '@noble/hashes/legacy.js';
import {bytesToHex} from '@noble/hashes/utils.js';

window.NobleMD5 = {
    // Returns the MD5 hash of a Uint8Array as a lowercase hex string.
    hex(uint8Array) {
        return bytesToHex(md5(uint8Array));
    },
};
