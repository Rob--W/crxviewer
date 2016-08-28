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
By default, this is only enabled on the Chrome Web Store. Upon clicking the button, two actions
become available:

  - Download extension as zip file
  - View source

The "View source" option opens a new tab with a simple viewer, with the following features:

  - Download-as-zip and download-as-crx at the upper-right corner.
  - List of file names, and the option to filter files with a regular expression.
  - Find files containing a string, or with content matching a regular expression.
  - Automatic beautification (formatting) of code
  - Syntax highlighting
  - Image preview
  - View content of embedded zip files.
  - Download Chrome Web Store extensions for a different platform (e.g. Chrome OS or NaCl).
  - View the contents of any URL or zip file.

As mentioned before, this extension activates on the Chrome Web Store by default.
It's also possible to view the source code of Chrome, Opera 15+ and Firefox extensions that are
hosted elsewhere. Further, there is an option to show a contextmenu entry on links whose target
is a Chromium extension. Both features can be toggled at the options page.

The "View source for all extensions" only shows a button when it detects the download of an
extension. This detection is implemented through MIME-type sniffing using the
[`declarativeWebRequest`](https://developer.chrome.com/extensions/declarativeWebRequest)
API, which is only available to Chromium beta/dev users (though it should soon be available to the
general public).

The Firefox addon is implemented as a WebExtension, which is recent technology. See
[firefox-stuff/compatibility.md](firefox-stuff/compatibility.md) for compatibility notes.

## Copyright
(c) 2013 - 2016 Rob Wu <rob@robwu.nl> (https://robwu.nl/)

