/**
 * (c) 2016 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// This is in a file separate from crxviewer.js so that I can rely on modern JS
// and DOM features, without requiring transpilation or breaking compatibility
// of the viewer with non-bleeding-edge browsers.
/* jshint esversion: 6 */
/* globals console, document, requestAnimationFrame, setTimeout */
/* exported SearchEngineElement, SearchEngineLogic */
'use strict';

/**
 * Perform a binary search on `array`.
 *
 * @param {object} array - A sorted array or array-like object.
 * @param {function} evaluate - A function that evaluates the selected array
 *    element. Should return a negative number if the search should continue at
 *    the left; positive if the search should continue at the right, and zero if
 *    the desired element has been found.
 * @param {boolean} [useCeiling=false] - By default, if the element is not
 *    found, the index before the last evaluated element is returned.
 *    If `useCeiling` is true, the index after the last evaluated element is
 *    returned. If these indices are out of bounds, then the index of the last
 *    evaluated element is returned.
 * @returns {number} The index of the found element.
 *    If an exact match was not found, the closest element is returned,
 *    according to `useCeiling`.
 */
function binarySearch(array, evaluate, useCeiling = false) {
    let left = 0;
    let right = array.length - 1;
    while (left <= right) {
        let mid = Math.floor(left + (right - left) / 2);
        let rating = evaluate(array[mid]);
        if (rating > 0) {
            left = mid + 1;
        } else if (rating < 0) {
            right = mid - 1;
        } else {
            return mid;
        }
    }
    // At this point we have the range [right, left] (with left = right + 1).
    let mid = useCeiling ? left : right;
    if (mid === array.length) --mid;
    if (mid === -1) ++mid;
    return mid;
}

// A model that processes search queries and displays the result.
class SearchEngineLogic {
    /**
     * @param {string} text - The text to search through
     */
    constructor(text) {
        this.text = text;

        this.regex = null;
        this.currentQuery = null;
        this.currentResults = [];

        this.currentIndex = -1;
        this.currentLine = -1;
        this.currentColumn = -1;
    }

    /**
     * List of integer offsets. Each index refers to a line, and the
     * corresponding value is the offset in `this.text` where the line starts.
     * The first line is at offset 0, any other line is a position after '\n'.
     * The lines and offsets start counting at 0.
     *
     * @type {number[]}
     */
    get lineOffsets() {
        let value = [0];
        let {text} = this;
        let i = 0;
        while ((i = text.indexOf('\n', i) + 1) !== 0) {
            value.push(i);
        }
        Object.defineProperty(this, 'lineOffsets', {value});
        return value;
    }

    /**
     * Get the text between `lineStart:columnStart` and `lineEnd:columnEnd`.
     *
     * @param {number} lineStart - Must be a non-negative integer, whose value
     *    is at most the number of '\n's in `this.text`. 0 is the first line.
     * @param {number} columnStart - Must be a non-negative integer, whose value
     *    is at most the number of characters at that line. 0 is the first char.
     * @param {number} lineEnd - Must be at least as large as `lineStart`.
     * @param {number} columnEnd - If `lineStart` is the same as `lineEnd`, then
     *    `columnEnd` must be at least as large as `columnStart`.
     */
    getText(lineStart, columnStart, lineEnd, columnEnd) {
        let textStartIndex = this.lineOffsets[lineStart] + columnStart;
        let textEndIndex = this.lineOffsets[lineEnd] + columnEnd;
        return this.text.substring(textStartIndex, textEndIndex);
    }

    findPrev() {
        // Backwards search looks for the query after the current position,
        // and then returns the result before it.
        // This means that if one looks for the last result starting from the
        // end of the document, that all search results are generated first.
        // This is done in this way because the query implementation using
        // RegExp.prototype.exec runs forwards, not backwards.
        let i = this.findIndex(result =>
            result.lineStart > this.currentLine ||
            (result.lineStart === this.currentLine &&
                result.columnStart >= this.currentColumn));
        if (i > 0) {
            return this.setAndReturnResult(i - 1);
        }

        if (i === -1 && this.currentResults.length === 0) {
            // Looked through the whole input and did not find any result.
            return null;
        }

        // Note: if i is 0 or -1, and the list is non-empty, then we want to
        // wrap around.
        // TODO: Show notification that the search wrapped around?
        if (i === 0) {
            // Deplete the generator because we want to get the last match.
            this.findAll();
        }
        return this.setAndReturnResult(this.currentResults.length - 1);
    }

    findNext() {
        let i = this.findIndex(result =>
            result.lineStart > this.currentLine ||
            (result.lineStart === this.currentLine &&
                result.columnStart > this.currentColumn));
        if (i >= 0) {
            return this.setAndReturnResult(i);
        }
        if (this.currentResults.length === 0) {
            return null;
        }
        // Wrap around.
        // TODO: Show notification that the search wrapped around?
        return this.setAndReturnResult(0);
    }

    /**
     * @returns {object[]} A direct reference to the internal result array.
     *    Do not mutate this return value.
     */
    findAll() {
        if (!this.currentQuery) {
            this.currentQuery = this.runQuery();
        }
        for (let result of this.currentQuery) {
            this.currentResults.push(result);
        }
        this.currentQuery.isAtEndOfSearch = true;
        return this.currentResults;
    }

    /**
     * Get the lower bound of the number of results.
     *
     * @param {number} limitTo - The number of results to find before stopping
     *    to look for more matches.
     * @returns {number} The known number of results. This may be more than
     *    `limitTo` if the results have already been generated before this call,
     *    for instance by a call to `findPrev`.
     */
    getMinimumResultCount(limitTo = 100) {
        if (!this.currentQuery) {
            this.currentQuery = this.runQuery();
        }
        if (!this.currentQuery.isAtEndOfSearch) {
            let yieldedResult;
            while (this.currentResults.length < limitTo &&
                !(yieldedResult = this.currentQuery.next()).done) {
                this.currentResults.push(yieldedResult.value);
            }
            if (yieldedResult && yieldedResult.done) {
                this.currentQuery.isAtEndOfSearch = true;
            }
        }
        return this.currentResults.length;
    }

    hasFoundAllResults() {
        return !!(this.currentQuery && this.currentQuery.isAtEndOfSearch);
    }

    /**
     * Select the i-th result and save its position so that the next call to
     * findPrev or findNext is relative to the selected result.
     *
     * @param {number} i - The position of the result in `this.currentResults`.
     * @returns {object} The result at position `i`. This object must not be
     *    mutated, and is guaranteed to have a '==='-identity to previously
     *    returned results until the query is reset via `setQuery`.
     */
    setAndReturnResult(i) {
        let result = this.currentResults[i];
        this.currentIndex = i;
        this.setCurrentPosition(result.lineStart, result.columnStart);
        return result;
    }

    /**
     * Set the position to use for the next findNext / findPrev call.
     *
     * @param {number} line - The line number (0-based).
     * @param {number} column - The column number (0-based).
     */
    setCurrentPosition(line, column) {
        this.currentLine = line;
        this.currentColumn = column;
    }

    /**
     * Iterate forwards through the results, until the `accept` function returns
     * true for the result. This method caches search results.
     *
     * @param {function} accept - Whether to return the result.
     * @returns {number} The index of the accepted result, -1 if none.
     */
    findIndex(accept) {
        if (!this.currentQuery) {
            this.currentQuery = this.runQuery();
        }

        // TODO: Replace with binary search?
        let index = this.currentResults.findIndex(accept);
        if (index >= 0) {
            return index;
        }

        let yieldedResult;
        // Note that a for..of loop cannot be used because exiting early will
        // close the generator.
        while (!(yieldedResult = this.currentQuery.next()).done) {
            this.currentResults.push(yieldedResult.value);
            if (accept(yieldedResult.value)) {
                return this.currentResults.length - 1;
            }
        }
        this.currentQuery.isAtEndOfSearch = true;
        return -1;
    }

    /**
     * An iterator that yields {lineStart, columnStart, lineEnd, columnEnd}.
     * The line and columns both start at 0. '\n' terminates a line and is
     * considered part of the line that it terminates.
     */
    *runQuery() {
        if (this.regex === null) {
            return;
        }
        let regex = new RegExp(this.regex.source, this.regex.flags);
        let line = 0;
        let match;
        while ((match = regex.exec(this.text)) !== null) {
            if (match[0].length === 0) {
                // Ensure eventual termination of the loop. For example,
                // /(?:)/ always matches, but never produce non-empty result.
                // /.*/ may match empty and non-empty results.
                ++regex.lastIndex;
                continue;
            }
            while (this.lineOffsets[line + 1] <= match.index) {
                ++line;
            }
            let lineStart = line;
            let matchEndIndex = match.index + match[0].length;
            while (this.lineOffsets[line + 1] <= matchEndIndex) {
                ++line;
            }
            let lineEnd = line;
            let columnStart = match.index - this.lineOffsets[lineStart];
            let columnEnd = matchEndIndex - this.lineOffsets[lineEnd];
            yield {
                lineStart,
                columnStart,
                lineEnd,
                columnEnd,
            };
        }
    }

    /**
     * @param {RegExp} [searchterm]
     */
    setQuery(searchterm = null) {
        if (searchterm) {
            let flags = searchterm.ignoreCase ? 'ig' : 'g';
            this.regex = new RegExp(searchterm.source, flags);
        } else {
            this.regex = null;
        }
        this.currentQuery = null;
        this.currentResults.length = 0;
    }
}

class SearchEngineElement {
    /**
     * @param {string} text - The text to search through
     */
    constructor(text) {
        // Strip NULL bytes because the browser doesn't render them. Including
        // them would result in a mismatch between the column numbers and the
        // actual rendered text, and consequently reduce the accuracy of the
        // _getResultCoords method.
        text = text.replace(/\x00/g, '');
        this.logic = new SearchEngineLogic(text);
        this.element = null;
        this.scrollableElement = null;
        this.connected = false;

        this.currentSearchTermSerialized = null;
        this.currentResult = null;
        // Container for rendering highlights.
        this.svgRoot = null;
        this.svgRootWrapper = null;
        // Set of already-rendered highlights.
        this.highlightedResults = new Set();
        this.isHighlighting = false;

        this._ondblclick_element = this._ondblclick_element.bind(this);
        this._onscroll_scrollableElement =
            this._debounce(this._onscroll_scrollableElement);
        this._onresize_window = this._debounce(this._onresize_window);
    }

    destroy() {
        this.currentSearchTermSerialized = null;
        this._removeSVGRoot();
        this.hideCurrentResult();
        this.unhighlightAll();
        this.disconnect();
        this.element = null;
        this.scrollableElement = null;
    }

    /**
     * Activate the search engine integration in the document.
     * `setElement` must have been called before this call.
     */
    connect() {
        this.element.addEventListener(
            'dblclick', this._ondblclick_element, true);
        this.scrollableElement.addEventListener(
            'scroll', this._onscroll_scrollableElement);
        this.scrollableElement.ownerDocument.defaultView.addEventListener(
            'resize', this._onresize_window);
        this.connected = true;
    }

    /**
     * Detach the search engine integration. This is the opposite of `connect`.
     */
    disconnect() {
        if (this.element) {
            this.element.removeEventListener(
                'dblclick', this._ondblclick_element, true);
        }
        if (this.scrollableElement) {
            this.scrollableElement.removeEventListener(
                'scroll', this._onscroll_scrollableElement);
            this.scrollableElement.ownerDocument.defaultView
                .removeEventListener('resize', this._onresize_window);
        }
        this.connected = false;
    }

    /**
     * Update the current query. If the search term was changed, the cached
     * results are reset.
     * Highlights and search terms are not automatically restored. Call
     * `findPrev`, `findNext` or `showVisibleHighlights` if wanted.
     *
     * @param {RegExp} [searchterm]
     */
    setQuery(searchterm = null) {
        let serialized = searchterm === null ? null : String(searchterm);
        if (serialized !== this.currentSearchTermSerialized) {
            this.currentSearchTermSerialized = serialized;
            this.logic.setQuery(searchterm);
            if (this.isHighlighting) {
                this.unhighlightAll();
                this.isHighlighting = true;
            }
            this.hideCurrentResult();
        }
    }

    /**
     * Start using the given element instead of the element that was passed on
     * construction to render results. Any previously rendered results in the
     * previous element are moved to the new element during this call.
     *
     * If `connect` was called before, make sure to call `disconnect` before
     * calling this method.
     *
     * @param {object} o
     * @param {HTMLElement} o.element - The container containing the exact text,
     *    with every line being wrapped in a separate child element.
     * @param {HTMLElement} o.scrollableElement - The container that shows
     *    scroll bars when the content in `element` overflows.
     */
    setElement({element, scrollableElement}) {
        this.element = element;
        this.scrollableElement = scrollableElement;

        if (this.svgRoot) {
            this._ensureSVGRoot();
            this.showVisibleHighlights();
        }
    }

    /**
     * Search backwards for the query set in `setQuery` and render the result in
     * the element as set by `setElement`.
     */
    findPrev() {
        this._renderResult(this.logic.findPrev());
    }

    /**
     * Search forwards for the query set in `setQuery` and render the result in
     * the element as set by `setElement`.
     */
    findNext() {
        this._renderResult(this.logic.findNext());
    }

    /**
     * Remove the marker of the current search result from the view.
     */
    hideCurrentResult() {
        if (this.svgRoot) {
            this.svgRoot.lastChild.textContent = '';
        }
        this.currentResult = null;
    }

    /**
     * Stop highlighting all results and remove all existing highlights.
     */
    unhighlightAll() {
        this.highlightedResults.clear();
        if (this.svgRoot) {
            this.svgRoot.firstChild.textContent = '';
        }
        this.isHighlighting = false;
    }

    /**
     * Find all matches of the query set in `setQuery` and highlight all
     * matching results in the element as set by `setElement`.
     */
    highlightAll() {
        this.isHighlighting = true;
        this.showVisibleHighlights();
    }

    getQueryStatus() {
        let resultTotal = this.logic.getMinimumResultCount();
        let isTotalDefinite = this.logic.hasFoundAllResults();
        return {
            hasQuery: this.currentSearchTermSerialized !== null,
            resultIndex: this.logic.currentIndex,
            resultTotal,
            isTotalDefinite,
        };
    }

    /**
     * Determine the approximate visible area and render all highlights in the
     * given area.
     */
    showVisibleHighlights() {
        if (!this.isHighlighting) {
            this._renderCurrentResultIfNeeded();
            return;
        }
        let scrollableRect = this.scrollableElement.getBoundingClientRect();
        // We want one page before and after, in case of page up/page down.
        let desiredYTop = scrollableRect.top - scrollableRect.height;
        let desiredYBottom = scrollableRect.bottom + scrollableRect.height;

        let topLine = binarySearch(this.element.children, child => {
            return desiredYTop - child.getBoundingClientRect().bottom;
        }, false);

        let bottomLine = binarySearch(this.element.children, child => {
            return desiredYBottom - child.getBoundingClientRect().top;
        }, true);

        this._renderBetweenLines(topLine, bottomLine);
        this._renderCurrentResultIfNeeded();
    }

    _renderCurrentResultIfNeeded() {
        if (!this.currentResult || !this.svgRoot || this.svgRoot.lastChild.childElementCount) {
            return;
        }
        // Previously a result was shown, but it is no longer visible, likely because
        // _ensureSVGRoot has reset the displayed highlights. Show again.
        // There is a SVG element, a current result, but not rendered. Render it now.
        this._renderResult(this.currentResult);
    }

    /**
     * Creates `this.svgRoot` if it did not exists, or if the dimensions have
     * changed (e.g. due to resize).
     * The DOM may be updated as a result.
     */
    _ensureSVGRoot() {
        let {width, height} = this.element.getBoundingClientRect();
        let wantsNewSVGRoot = !this.svgRoot ||
            // If the width changes, then the highlights have to be recalculated
            // in case of changed word-wrapping behavior.
            Math.floor(width) !==
            Math.floor(this.svgRoot.getAttribute('width'));
        if (!this.svgRootWrapper) {
            this.svgRootWrapper = document.createElement('div');
            this.svgRootWrapper.className = 'search-result-container-wrapper';
        }
        if (wantsNewSVGRoot) {
            this.highlightedResults.clear();
            this.svgRootWrapper.textContent = '';
            this.svgRoot = this._createSVGRoot(width, height);
            this.svgRootWrapper.appendChild(this.svgRoot);
        }
        // This is true if either the element was just created,
        // or if setElement was called.
        if (this.svgRootWrapper.nextSibling !== this.element) {
            this.element.parentNode.insertBefore(
                this.svgRootWrapper, this.element);
        }
    }

    _removeSVGRoot() {
        if (this.svgRoot) {
            this.svgRootWrapper.remove();
            this.svgRootWrapper = null;
            this.svgRoot = null;
        }
    }

    /**
     * Create a <svg> element for use in `this.svgRoot`, which has two children:
     * - `this.svgRoot.firstChild` will contain highlighted results.
     * - `this.svgRoot.lastChild` will contain one specific search result.
     */
    _createSVGRoot(width, height) {
        const NS_SVG = 'http://www.w3.org/2000/svg';

        let svg = document.createElementNS(NS_SVG, 'svg');
        svg.setAttribute('class', 'search-result-container');
        svg.setAttribute('width', width);
        svg.setAttribute('height', height);
        svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);

        let highlightContainer = document.createElementNS(NS_SVG, 'g');
        highlightContainer.setAttribute('class', 'search-result-highlight');
        svg.appendChild(highlightContainer);

        // Always render the matched result above highlights, because there can
        // be multiple highlighted results, whereas only one match is shown at
        // a time.
        let resultContainer = document.createElementNS(NS_SVG, 'g');
        resultContainer.setAttribute('class', 'search-result-match');
        svg.appendChild(resultContainer);
        return svg;
    }

    /**
     * Render highlighted results in the given line range (inclusive, 0-based).
     *
     * @param {number} lineStart - Start of range. Must be at least 0.
     * @param {number} lineEnd - End of range. Must be at least as high as
     *    `lineStart`, and no more than the number of '\n's in `this.text`.
     */
    _renderBetweenLines(lineStart, lineEnd) {
        // Initializes svgRoot and empties highlightedResults if needed
        this._ensureSVGRoot();

        let allResults = this.logic.findAll();
        let results = [];
        for (let result of allResults) {
            if (result.lineEnd < lineStart) {
                continue;
            }
            if (result.lineStart > lineEnd) {
                break;
            }
            if (!this.highlightedResults.has(result)) {
                this.highlightedResults.add(result);
                results.push(result);
            }
        }

        let fragment = document.createDocumentFragment();

        let svgRect = this.svgRoot.getBoundingClientRect();
        for (let result of results) {
            fragment.appendChild(
                this._createSVGPath(
                    this._getResultCoords(svgRect.left, svgRect.top, result)));
        }
        this.svgRoot.firstChild.appendChild(fragment);
    }

    /**
     * Throttle a callback, to be used as an event handler.
     *
     * @param {function} callback - A method that is invoked on `this`.
     * @returns {function} A debounced version of the callback.
     */
    _debounce(callback) {
        let didScheduleDispatch = false;
        return event => {
            if (didScheduleDispatch) {
                return;
            }
            didScheduleDispatch = true;
            setTimeout(() => {
                // Schedule at the next animation frame because the handler may
                // force layout and modify DOM.
                requestAnimationFrame(() => {
                    didScheduleDispatch = false;
                    if (this.connected) {
                        callback.call(this);
                    }
                });
            }, 100);
        };
    }

    /**
     * The handler for the 'dblclick' event on `this.element`.
     */
    _ondblclick_element(event) {
        let {target} = event;
        // Find the child element of this.element. Note that an element is
        // always found in this way, because the event is only dispatched on
        // descendants of `this.element`.
        while (target.parentNode !== this.element) {
            target = target.parentNode;
        }
        let line = Array.prototype.indexOf.call(this.element.children, target);
        let column = 0;
        this.logic.setCurrentPosition(line, column);
    }

    /**
     * The handler for a debounced 'scroll' event on `this.scrollableElement`.
     */
    _onscroll_scrollableElement() {
        this.showVisibleHighlights();
    }

    /**
     * The handler for a debounced 'resize' event on `window`.
     */
    _onresize_window() {
        this.showVisibleHighlights();
    }

    /**
     * Mark the given search result and scroll it into the view.
     */
    _renderResult(result) {
        this.currentResult = result;
        if (!result) {
            this.hideCurrentResult();
            // result === null, so no result. Do nothing for now.
            console.log('No results for ' + this.currentSearchTermSerialized);
            return;
        }
        this._ensureSVGRoot();
        let svgRect = this.svgRoot.getBoundingClientRect();
        let coords = this._getResultCoords(svgRect.left, svgRect.top, result);
        let svgPath = this._createSVGPath(coords);

        let scrollableRect = this.scrollableElement.getBoundingClientRect();
        let resultRect = coords.mainRect.rectRelativeToViewport;
        if (resultRect.height >= scrollableRect.height) {
            // Show start of result if it does not fit.
            this.scrollableElement.scrollTop +=
                resultRect.top - scrollableRect.top;
        } else if (resultRect.top < scrollableRect.top ||
                   resultRect.bottom > scrollableRect.bottom) {
            // Vertically center otherwise.
            this.scrollableElement.scrollTop +=
                resultRect.top - scrollableRect.top +
                resultRect.height / 2 - scrollableRect.height / 2;
        }
        this.svgRoot.lastChild.textContent = '';
        this.svgRoot.lastChild.appendChild(svgPath);
    }

    /**
     * Retrieve the text node at the given line that contains the column.
     * This is because a line can be broken into multiple text nodes.
     *
     * @param {number} line - Line, 0-based.
     * @param {column} column - Column, 0-based.
     * @return {[HTMLElement, Text, number]}
     *   The line element for the given line,
     *   The text node satisfying the query (if any, otherwise null).
     *   The position inside the text node where the column starts.
     */
    _getTextNodeAt(line, column) {
        let lineElement = this.element.children[line];
        let node = null;
        // 4 = NodeFilter.SHOW_TEXT
        let walker = document.createTreeWalker(lineElement, 4);
        let offset = column;
        while (walker.nextNode()) {
            node = walker.currentNode;
            if (offset - node.length > 0) {
                offset -= node.length;
            } else {
                return [lineElement, node, offset];
            }
        }
        // No node containing the column. Return the end of the last node.
        // This is often a legitimate situation when columnEnd is used, because
        // it indicates the position after the end of the result string.
        // if we are at the end of a string, then it is string.length + 1.
        // This can also happen if the node content does not match the actual
        // text as known by the search engine (e.g. when the browser decides to
        // unexpectedly strip some characters).
        if (node) {
            return [lineElement, node, node.length];
        }
        // No node at all. Maybe the line is just empty.
        return [lineElement, null, 0];
    }

    /**
     * Calculates a rectangle for the character at the given position.
     * The parameters should be the same as the value returned by _getTextNodeAt.
     *
     * @returns {DOMRect|object} A rectangle that describes the position of
     *   the character at the given offset in the text node.
     *   (or, if there is no text, the left position of the line).
     */
    _getNarrowRect(lineElement, textNode, offset) {
        if (textNode) {
            // Most common case: text node found.
            // TODO: Re-use Range instead of creating it over and over again?
            let range = document.createRange();
            range.setStart(textNode, offset);
            range.setEnd(textNode, offset);
            // In Safari, gBCR returns an all-zeroes rectangle, so use gCR instead.
            var rects = range.getClientRects();
            if (rects.length === 1) {
                return rects[0];
            }
            return range.getBoundingClientRect();
        }
        // No text node found, the line element is empty.
        let rect = lineElement.getBoundingClientRect();
        return {
            top: rect.top,
            left: rect.left,
            right: rect.left,
            bottom: rect.bottom,
            width: 0,
            height: rect.height
        };
    }

    /**
     * Calculates the coordinates of the result, relative to (rootX, rootY).
     * (rootX, rootY) is relative to the upper-left corner of the browser
     * viewport.
     *
     * @param {number} rootX - The x-coordinate of `this.svgRoot`.
     * @param {number} rootY - The y-coordinate of `this.svgRoot`.
     * @param {object} result
     * @return {object} An object with the following properties:
     *  - mainRect: bounding box around the whole result.
     *  - startRect: bounding box before the first text node in the result.
     *  - endRect: bounding box after the last text node in the result.
     */
    _getResultCoords(rootX, rootY, result) {
        let [firstElem, firstNode, firstOffset] =
            this._getTextNodeAt(result.lineStart, result.columnStart);
        let [lastElem, lastNode, lastOffset] =
            this._getTextNodeAt(result.lineEnd, result.columnEnd);
        let startRect = this._getNarrowRect(firstElem, firstNode, firstOffset);
        let endRect = this._getNarrowRect(lastElem, lastNode, lastOffset);

        let mainRect = {
            left: 0,
            right: 0,
            top: startRect.top,
            bottom: endRect.bottom,
            get width() {
                return this.right - this.left;
            },
            get height() {
                return this.bottom - this.top;
            },
        };

        mainRect.left = Math.min(startRect.left, endRect.left);
        mainRect.right = Math.max(startRect.right, startRect.right);
        if (startRect.top !== endRect.top) {
            // Result spans multiple lines. Use the Range API to find the
            // bounding box around all contained text nodes.

            // If the lines themselves are empty, find the nearest non-empty
            // line. We cannot select the line element itself, because then the
            // Range API would select the full width of the line instead of just
            // the width of the text nodes.
            let lineStart = result.lineStart;
            let lineEnd = result.lineEnd;
            if (!firstNode) {
                while (!firstNode && ++lineStart <= lineEnd) {
                    firstNode = this.element.children[lineStart].firstChild;
                }
                firstOffset = 0;
            }
            if (firstNode && !lastNode) {
                while (!lastNode && lineStart <= --lineEnd) {
                    lastNode = this.element.children[lineEnd].lastChild;
                }
                lastNode = lastNode || firstNode.parentNode.lastChild;
                // In case lastNode is a text node, then we have to take the
                // length of its nodeValue. Otherwise it is probably an
                // Element, and we can just choose 0.
                lastOffset = lastNode && lastNode.length || 0;
            }
            if (firstNode && lastNode) {
                // Skipped empty lines and found some non-empty lines.
                let range = document.createRange();
                range.setStart(firstNode, firstOffset);
                range.setEnd(lastNode, lastOffset);
                let rect = range.getBoundingClientRect();
                // Only proceed if the bounding rect is non-empty.
                if (rect.height) {
                    mainRect.left = Math.min(mainRect.left, rect.left);
                    mainRect.right = Math.max(mainRect.right, rect.right);
                }
            }
        }

        const transformRect = (rect) => {
            return {
                rectRelativeToViewport: rect,
                left: rect.left - rootX,
                right: rect.right - rootX,
                top: rect.top - rootY,
                bottom: rect.bottom - rootY,
                width: rect.width,
                height: rect.height,
            };
        };
        mainRect = transformRect(mainRect);
        startRect = transformRect(startRect);
        endRect = transformRect(endRect);
        return {mainRect, startRect, endRect};
    }

    /**
     * Generates the a path that draws an outline around the result in the DOM.
     *
     * @param {object} coords - The return value of _getResultCoords.
     * @return {SVGPathElement} A SVG path relative to the upper-left corner of
     *   `this.svgRoot`.
     */
    _createSVGPath({mainRect, startRect, endRect}) {
        // Now we determine the path around the selection.
        //
        //   -- -- AA
        //   BB CC DD
        //   EE -- --
        //
        // What we know:
        // - mainRect = bounding box around all text nodes
        // - startRect = bounding box around AA
        // - endRect = bounding box around EE
        //
        // We will use mainRect where possible (because it is possible that
        // startRect or endRect are not exactly at the edge of the bounding box
        // due to other nodes sticking out.
        let d = [
            // Upper-left of AA.
            'M',
            startRect.left,
            mainRect.top,
            // Upper-right of AA (main rect).
            'L',
            mainRect.right,
            mainRect.top,
            // Bottom-right of DD.
            'L',
            mainRect.right,
            endRect.top,
            // Upper-right of EE.
            'L',
            endRect.right,
            endRect.top,
            // Bottom-right of EE.
            'L',
            endRect.right,
            endRect.bottom,
            // Bottom-left of EE (main rect).
            'L',
            mainRect.left,
            mainRect.bottom,
            // Upper-left of BB.
            'L',
            mainRect.left,
            startRect.bottom,
            // Bottom-left of AA.
            'L',
            startRect.left,
            startRect.bottom,
            // Upper-left of AA.
            'Z',
        ].join(' ');

        const NS_SVG = 'http://www.w3.org/2000/svg';
        let path = document.createElementNS(NS_SVG, 'path');
        path.setAttribute('d', d);
        return path;
    }
}
