#!/bin/bash
wget https://raw.github.com/einars/js-beautify/master/js/lib/beautify-css.js
wget https://raw.github.com/einars/js-beautify/master/js/lib/beautify-html.js
wget https://raw.github.com/einars/js-beautify/master/js/lib/beautify.js

[ ! -d unpackers ] && mkdir unpackers
cd unpackers
wget https://raw.github.com/einars/js-beautify/master/js/lib/unpackers/javascriptobfuscator_unpacker.js
wget https://raw.github.com/einars/js-beautify/master/js/lib/unpackers/myobfuscate_unpacker.js
wget https://raw.github.com/einars/js-beautify/master/js/lib/unpackers/p_a_c_k_e_r_unpacker.js
wget https://raw.github.com/einars/js-beautify/master/js/lib/unpackers/urlencode_unpacker.js
