[CRX Viewer for Firefox](https://addons.mozilla.org/firefox/addon/crxviewer/)
is implemented as a
[WebExtension](https://developer.mozilla.org/en-US/Add-ons/WebExtensions).
This is recent technology, and not all Firefox versions support it. This page
lists the bugs that affect this extension. There are also bugs for which I have
found a satisfactory work-around, these are not listed below (but you can read
about them in the source code).

### Firefox 44
- Not supported, the extension button does not even show up.

### Firefox 45
- Extension button on addon/webstore pages. Clicking the extension button shows
  a menu with that allows you to view the source code or download as a zip file.

### Firefox 46
- Contextmenu items appear on all links (should be limited to extension links,
  but that does not work because of https://bugzil.la/1275126).
  There should be also a context menu on some pages (AMO/CWS), but this is not
  yet supported by Firefox.

### Firefox 47

### Firefox 48
- The preference page is now visible in the addon manager. This can be used to
  disable context menu items (https://bugzil.la/1250784).
- Extension URLs with a colon are viewed properly (https://bugzil.la/719905).
  The ugly work-around to use `%u003A` instead of `%3A` is not needed any more.

### Firefox 49
- The download API now support `blob:` URLs (https://bugzil.la/1271345).
  This is now used for downloading via the Download button at the extension
  button (opposed to downloading via the tab).

### Firefox 50
- Linked downloads are now implemented using `blob:`-URLs instead of
  `data:`-URLs because Firefox with e10s now supports `blob:moz-extension:`
  (https://bugzil.la/1287346).
- Context menus are properly cleaned up when the addon is re-enabled
  (https://bugzil.la/1287359). Now it is not possible to accidentally have two
  duplicate context menu items.
- Page-specific context menus are now working as intended (bugzil.la/1275116).
- Link-specific context menus are now working as intended (bugzil.la/1275126).


### Open bugs
The following bugs are still open in Firefox Nightly:

(no relevant bugs)
