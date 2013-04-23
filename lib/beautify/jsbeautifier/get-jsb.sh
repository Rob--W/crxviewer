#!/bin/bash
wget https://raw.github.com/einars/js-beautify/master/beautify-css.js
wget https://raw.github.com/einars/js-beautify/master/beautify-html.js
wget https://raw.github.com/einars/js-beautify/master/beautify.js

[ ! -d unpackers ] && mkdir unpackers
cd unpackers
wget https://raw.github.com/einars/js-beautify/master/unpackers/javascriptobfuscator_unpacker.js
wget https://raw.github.com/einars/js-beautify/master/unpackers/myobfuscate_unpacker.js
wget https://raw.github.com/einars/js-beautify/master/unpackers/p_a_c_k_e_r_unpacker.js
wget https://raw.github.com/einars/js-beautify/master/unpackers/urlencode_unpacker.js
