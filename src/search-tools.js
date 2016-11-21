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

    // Note: Do not mutate the return value.
    findAll() {
        if (!this.currentQuery) {
            this.currentQuery = this.runQuery();
        }
        for (let result of this.currentQuery) {
            this.currentResults.push(result);
        }
        return this.currentResults;
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

        for (let result of this.currentQuery) {
            this.currentResults.push(result);
            if (accept(result)) {
                return this.currentResults.length - 1;
            }
        }
        return -1;
    }

    /**
     * An iterator that yields {lineStart, columnStart, lineEnd, columnEnd}.
     * The line and columns both start at 0. '\n' terminates a line and is
     * considered part of the line that it terminates.
     */
    *runQuery() {
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
     * @param {RegExp} searchterm
     */
    setQuery(searchterm) {
        let flags = searchterm.ignoreCase ? 'ig' : 'g';
        this.regex = new RegExp(searchterm.source, flags);
        this.currentQuery = null;
        this.currentResults.length = 0;
    }
}

class SearchEngineElement {
    /**
     * @param {string} text - The text to search through
     */
    constructor(text) {
        this.logic = new SearchEngineLogic(text);
        this.element = null;
        this.scrollableElement = null;
        this.connected = false;

        this.currentSearchTermSerialized = null;
        this.currentResult = null;
        this.currentResultElement = null;
        // Set of already-rendered highlights.
        this.highlightedResults = new Set();
        // List of pairs [line, result element] (unordered!)
        this.shownResults = [];
        this.isHighlighting = false;

        this._ondblclick_element = this._ondblclick_element.bind(this);
        this._onscroll_scrollableElement =
            this._debounce(this._onscroll_scrollableElement);
        this._onresize_window = this._debounce(this._onresize_window);
    }

    destroy() {
        this.currentSearchTermSerialized = null;
        this.currentResult = null;
        this.currentResultElement = null;
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
     *
     * @param {RegExp} [searchterm]
     */
    setQuery(searchterm = null) {
        let serialized = String(searchterm);
        if (serialized !== this.currentSearchTermSerialized) {
            this.currentSearchTermSerialized = serialized;
            if (searchterm) {
                this.logic.setQuery(searchterm);
            }
            // TODO: Remove invalid highlights.
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

        if (this.currentResultElement) {
            let lineElement =
                this.element.children[this.currentResult.lineStart];
            lineElement.insertBefore(
                this.currentResultElement, lineElement.firstChild);
        }
        for (let [lineStart, resultElement] of this.shownResults) {
            let lineElement = this.element.children[lineStart];
            // Move from old tree to new tree.
            lineElement.insertBefore(resultElement, lineElement.firstChild);
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
     * Stop highlighting all results and remove all existing highlights.
     */
    unhighlightAll() {
        this.highlightedResults.clear();
        for (let [, resultElement] of this.shownResults) {
            resultElement.remove();
        }
        this.shownResults.length = 0;
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

    /**
     * Determine the approximate visible area and render all highlights in the
     * given area.
     */
    showVisibleHighlights() {
        if (!this.isHighlighting) {
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
    }

    /**
     * Render highlighted results in the given line range (inclusive, 0-based).
     *
     * @param {number} lineStart - Start of range. Must be at least 0.
     * @param {number} lineEnd - End of range. Must be at least as high as
     *    `lineStart`, and no more than the number of '\n's in `this.text`.
     */
    _renderBetweenLines(lineStart, lineEnd) {
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

        this._renderHighlightedResults(results);
    }

    /**
     * Create highlights for all given results, and insert each highlight in the
     * document.
     *
     * @param {Object[]} results - The results to render.
     */
    _renderHighlightedResults(results) {
        // Normally (in _renderResult), the result is rendered by appending an
        // invisible prefix (for positioning), followed by the actual text.
        // When we highlight all results, we combine results that appear on the
        // same line(s), because otherwise the above logic can lead to quadratic
        // memory usage (in terms of the text size) when the text is one long
        // line and the search matches one result (because every character would
        // then have its own wrapper and prefix).
        let bufferedResults = [];
        // The line where the first item in the buffer starts.
        let firstLine = 0;
        // The line where the last item in the buffer ended.
        let lastLine = 0;
        // The column where the last item in the buffer ended.
        let lastColumn = 0;

        const flushBufferedResults = () => {
            if (bufferedResults.length) {
                let resultElement = this._insertResults(
                    firstLine, bufferedResults, 'search-result-highlight');
                this.shownResults.push([firstLine, resultElement]);
                bufferedResults.length = 0;
            }
        };

        for (let result of results) {
            if (lastLine !== result.lineStart) {
                flushBufferedResults();
                firstLine = result.lineStart;
                lastColumn = 0;
            }
            bufferedResults.push(
                this.logic.getText(
                    result.lineStart, lastColumn,
                    result.lineStart, result.columnStart),
                this.logic.getText(
                    result.lineStart, result.columnStart,
                    result.lineEnd, result.columnEnd));
            lastLine = result.lineEnd;
            lastColumn = result.columnEnd;
        }
        flushBufferedResults();
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
        if (this.currentResultElement) {
            this.currentResultElement.remove();
            this.currentResultElement = null;
        }
        if (!result) {
            // result === null, so no result. Do nothing for now.
            // TODO: Show hint that search did not yield any results?
            console.log('No results for ' + this.currentSearchTermSerialized);
            return;
        }
        let resultElement = this._insertResults(result.lineStart, [
            this.logic.getText(
                result.lineStart, 0,
                result.lineStart, result.columnStart),
            this.logic.getText(
                result.lineStart, result.columnStart,
                result.lineEnd, result.columnEnd),
        ], 'search-result-match');
        // The visual indicator of a search result is more important than that
        // of highlight-all.
        resultElement.classList.add('search-result-important');
        this.currentResultElement = resultElement;

        let scrollableRect = this.scrollableElement.getBoundingClientRect();
        // Note: `resultElement.firstChild` contains the actual text, whereas
        // `resultElement` is a zero-height element used for positioning.
        // So we need `resultElement.firstChild` to determine the dimensions of
        // the rendered result.
        let resultRect = resultElement.firstChild.getBoundingClientRect();
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
    }

    /**
     * Insert the given search results (texts) at the given line.
     *
     * @param {number} lineStart - The first line of resultTexts.
     * @param {string[]} resultTexts - A list of even length. The odd indices
     *    contain text that should not be highlighted; the even indices contain
     *    text that should be highlighted. The text should be directly adjacent
     *    to each other: If all text is concatenated and inserted in the line
     *    given by `lineStart`, then the text should align perfectly with the
     *    actual text on that line.
     * @param {string} highlightClassName - The class name to use for the
     *    element which contains the matched result.
     * @return {HTMLElement} The element that was inserted at line `lineStart`.
     */
    _insertResults(lineStart, resultTexts, highlightClassName) {
        // Assuming:
        // - Every line in `this.element` is wrapped in a separate element.
        // - The vertical spacing between adjacent elements and lines within
        //   the elements are identical.
        // - All text in `this.element` has one uniform text style, at the very
        //   least white-space:pre-wrap and word-break:break-all.
        //
        // The trick that we use to implement highlighting is to add an overlay
        // with transparent text, and a visual marker around the matched text.
        // Because the overlay and the actual text have the same style, the
        // visual marker will align well with the actual text.

        // Contains the results. Will be positioned over the actual text.
        let wrapperElement = document.createElement('div');
        wrapperElement.className = 'search-result-wrapper';

        for (let i = 0; i < resultTexts.length; i += 2) {
            if (resultTexts[i]) {
                let prefixElement = document.createElement('span');
                prefixElement.className = 'search-result-prefix';
                prefixElement.textContent = resultTexts[i];
                wrapperElement.appendChild(prefixElement);
            }

            let highlightedElement = document.createElement('span');
            highlightedElement.className = highlightClassName;
            highlightedElement.textContent = resultTexts[i + 1];

            wrapperElement.appendChild(highlightedElement);
        }

        // Auxilary element to help with positioning.
        let resultElement = document.createElement('div');
        resultElement.className = 'search-result-anchor';
        resultElement.appendChild(wrapperElement);

        let lineElement = this.element.children[lineStart];
        if (!lineElement.firstChild) {
            // When the list item is empty, it initially has a height.
            // When we insert our block-style element, the height changes to
            // match that block-style element (of height 0, per stylesheet).
            // To prevent this from happening, insert a <wbr> element.
            // Note: We don't clean up this <wbr> element, because I expect that
            // it does not matter for rendering whether it is present or not.
            lineElement.appendChild(document.createElement('wbr'));
        }
        lineElement.insertBefore(resultElement, lineElement.firstChild);
        return resultElement;
    }
}
