/**
 * (c) 2016 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* globals Prism, console */
/* jshint esversion:6 */
'use strict';

function checkHighlightSource(extension, input, expected) {
    var actual = Prism.rob.highlightSource(input, extension);
    // For now we strip \n from the output because each line is
    // wrapped in a block-level element.
    expected = expected.replace(/\n<li/g, '<li');
    // Normalize appearance, in case we change the fixed attributes.
    actual = actual.replace(/^<ol class="line-nums"/, '<ol');
    actual = actual.replace(/<li class="odd-code-line"/g, '<li');
    console.assert(expected == actual, `highlightSource with ${extension}
${input}
Expected:
${expected}
Actual:
${actual}`);
}

console.log('Testing whether highlighting works as expected');

// Nothing.
checkHighlightSource('html',
``,
`<ol><li></li></ol>`);

// Plain text only.
checkHighlightSource('html',
`a`,
`<ol><li>a</li></ol>`);

checkHighlightSource('html',
`a
b`,
`<ol><li>a</li>
<li>b</li></ol>`);

checkHighlightSource('html',
`a
b
c`,
`<ol><li>a</li>
<li>b</li>
<li>c</li></ol>`);

// Whitespace.
checkHighlightSource('html',
`\t`,
`<ol><li>\t</li></ol>`);

checkHighlightSource('html',
`\t\t`,
`<ol><li>\t\t</li></ol>`);

checkHighlightSource('html',
`
\x20
\t
`,
`<ol><li></li>
<li> </li>
<li>\t</li>
<li></li></ol>`);

// Tokens
checkHighlightSource('html',
`<a>`,
`<ol><li><span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>a</span><span class="token punctuation">></span></span></li></ol>`);

checkHighlightSource('html',
`<a></a>`,
`<ol><li><span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>a</span><span class="token punctuation">></span></span><span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>a</span><span class="token punctuation">></span></span></li></ol>`);

checkHighlightSource('html',
`<a>
</a>`,
`<ol><li><span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>a</span><span class="token punctuation">></span></span></li>
<li><span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>a</span><span class="token punctuation">></span></span></li></ol>`);

checkHighlightSource('html',
`<a>
<b>`,
`<ol><li><span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>a</span><span class="token punctuation">></span></span></li>
<li><span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>b</span><span class="token punctuation">></span></span></li></ol>`);

// Mixed token + plain text
checkHighlightSource('html',
`<a>mixed text`,
`<ol><li><span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>a</span><span class="token punctuation">></span></span>mixed text</li></ol>`);

checkHighlightSource('html',
`<a>mixed
text`,
`<ol><li><span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>a</span><span class="token punctuation">></span></span>mixed</li>
<li>text</li></ol>`);

// Mixed token spanning multiple lines.
checkHighlightSource('html',
`<!-- base case -->`,
`<ol><li><span class="token comment">&lt;!-- base case --></span></li></ol>`);

checkHighlightSource('html',
`<!-- split
case -->`,
`<ol><li><span class="token comment">&lt;!-- split</span></li>
<li><span class="token comment">case --></span></li></ol>`);

// Some JS examples
checkHighlightSource('js',
`function() {}`,
`<ol><li><span class="token keyword">function</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span><span class="token punctuation">}</span></li></ol>`);

const LONG_STRING = 'A'.repeat(1000);
checkHighlightSource('js',
`// ${LONG_STRING}`,
`<ol><li><span class="token comment">// ${LONG_STRING}</span></li></ol>`);

// Some unknown language example.
checkHighlightSource('unknownextension',
`a<>&amp;`,
`<ol><li>a&lt;>&amp;amp;</li></ol>`);

// Auto-detect mark-up even without file name
checkHighlightSource('',
`<a>`,
`<ol><li><span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>a</span><span class="token punctuation">></span></span></li></ol>`);
