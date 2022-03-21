# Chrome extension source viewer (CRX Viewer)

View the source code of any Chrome extension in the Chrome Web store without installing it.  
https://chrome.google.com/webstore/detail/chrome-extension-source-v/jifpbeccnghkjeaalbbjmodiffmgedin

Also available for Opera and Opera's add-on gallery.  
https://addons.opera.com/extensions/details/extension-source-viewer/

And also available for Firefox and addons.mozilla.org (WebExtensions and other Firefox addon types).
https://addons.mozilla.org/firefox/addon/crxviewer/

Online demo (select a .crx / .nex / .zip / .xpi from your disk or a URL to try out the viewer):  
https://robwu.nl/crxviewer/

## Features

This Chrome extension adds a button to right of the omnibox when a CRX file has been detected.
This button appears in the following extension stored:

  - Chrome Web Store
  - Opera add-ons gallery
  - Firefox add-ons gallery
  - Thunderbird add-ons gallery
  - Microsoft Edge Addons store

Upon clicking the button, two actions become available:

  - Download extension as zip file
  - View source

The default action (showing the above options) can be changed via the "Primary action on click"
menu that appears when you right-click on the extension button.

The "View source" option opens a new tab with a simple viewer, with the following features:

  - Download-as-zip and download-as-crx at the upper-right corner.
  - List of file names, and the option to filter files with a regular expression.
  - Find files containing a string, or with content matching a regular expression.
  - Quickly jump between search results, or from/to a specific line.
  - Automatic beautification (formatting) of code
  - Syntax highlighting
  - Image preview
  - Show hashes (md5, sha1, sha256, sha384, sha512) of the file content.
  - View content of embedded zip files.
  - Download Chrome Web Store extensions for a different platform (e.g. Chrome OS or NaCl).
  - View the contents of any URL or zip file.
  - Permalink to file and search result within a zip or extension file.

As mentioned before, this extension activates on the Chrome Web Store by default.
It's also possible to view the source code of Chrome, Opera 15+ and Firefox extensions that are
hosted elsewhere. Further, there is an option to show a contextmenu entry on links whose target
is a Chromium extension. Both features can be toggled at the options page.

## Copyright
(c) 2013 - 2022 Rob Wu <rob@robwu.nl> (https://robwu.nl/)

This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at http://mozilla.org/MPL/2.0/.
