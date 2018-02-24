/*
  Extension Source Explorer - explore source code of various browsers add-ons using CRX Viewer engine
  Copyright (C) 2018 Off JustOff <Off.Just.Off@gmail.com>

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU Affero General Public License as published
  by the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU Affero General Public License for more details.

  You should have received a copy of the GNU Affero General Public License
  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

let Cc = Components.classes, Ci = Components.interfaces, Cu = Components.utils;
Cu.import("resource://gre/modules/Services.jsm");

const branch = "extensions.esrc-explorer.";
const apmo_pattern = /^https?:\/\/addons\.palemoon\.org\/addon\/(.*?)\//;
const apmo_download_pattern = /^https?:\/\/addons\.palemoon\.org\/\?component=download&id=(.+?)&version=(.+?)&hash/;
const apmo_match_pattern = '*://addons.palemoon.org/?component=download*';

let styleSheetService = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);
let styleSheetURI = Services.io.newURI("chrome://esrc-explorer/skin/style.css", null, null);

let gWindowListener, navigator;

function ESrcExplorer(aWindow) {
  this.init(aWindow);
}
ESrcExplorer.prototype = {

  init: function(aWindow) {
    this.browserWindow = aWindow;
    this.tabBrowser = aWindow.gBrowser;

    if (Services.prefs.getBoolPref(branch + "showButton")) {
      this.addButton();
    }

    if (Services.prefs.getBoolPref(branch + "showContext")) {
      this.addContext();
    }

    this.prefBranch = Services.prefs.getBranch(branch);
    this.prefBranch.addObserver("", this, false);
  },

  done: function() {
    this.prefBranch.removeObserver("", this);
    this.prefBranch = null;

    if (Services.prefs.getBoolPref(branch + "showButton")) {
      this.removeButton();
    }

    if (Services.prefs.getBoolPref(branch + "showContext")) {
      this.removeContext();
    }

    this.tabBrowser = null;
    this.browserWindow = null;
  },

  observe: function(aSubject, aTopic, aData) {
    if (aTopic != "nsPref:changed") return;
    switch (aData) {
      case 'showButton':
        if (Services.prefs.getBoolPref(branch + "showButton")) {
          this.addButton();
        } else {
          this.removeButton();
        }
        break;
      case 'showContext':
        if (Services.prefs.getBoolPref(branch + "showContext")) {
          this.addContext();
        } else {
          this.removeContext();
        }
        break;
    }
  },

  openExplorerOrSave: function(aUrl, aSave) {
    let crx_url, filename;
    if (apmo_pattern.test(aUrl)) {
      crx_url = this.tabBrowser.getBrowserForTab(this.tabBrowser.selectedTab).
                  contentDocument.getElementsByClassName("dllink_green")[0].href;
    } else if (apmo_download_pattern.test(aUrl)) {
      crx_url = aUrl;
    } else {
      crx_url = get_crx_url(aUrl);
    }
    if (!crx_url) {
      Cu.reportError('Cannot find extension URL');
      return;
    }
    let match1 = apmo_download_pattern.exec(crx_url);
    if (match1) {
      let match2 = apmo_pattern.exec(this.tabBrowser.selectedTab.linkedBrowser.currentURI.spec);
      if (match2) {
        filename = match2[1] + "-" + match1[2] + ".zip";
      } else {
        filename = match1[1] + "-" + match1[2] + ".zip";
      }
    } else {
      filename = get_zip_name(crx_url);
    }
    if (aSave) {
      this.browserWindow.internalSave(crx_url, null, filename, null, "application/zip",
        true, null, null, this.tabBrowser.selectedTab.linkedBrowser.currentURI,
        this.tabBrowser.ownerDocument, false, null);
    } else {
      let newtab = this.tabBrowser.addTab("chrome://esrc-explorer/content/crxviewer.html" +
                   '?' + encodeQueryString({crx: crx_url, zipname: filename}), {relatedToCurrent: true})
      this.tabBrowser.moveTabTo(newtab, this.tabBrowser.tabContainer.selectedIndex + 1);
      this.tabBrowser.selectedTab = newtab;
    }
  },

  updateButton: function(aURI) {
    let isExtUrl = cws_pattern.test(aURI.spec) || ows_pattern.test(aURI.spec) ||
                   amo_pattern.test(aURI.spec) || amo_file_version_pattern.test(aURI.spec) ||
                   apmo_pattern.test(aURI.spec);
    if (isExtUrl) {
      this.button.style.display = "block";
    } else {
      this.button.style.display = "none";
    }
  },

  onLocationChange: function(aWebProgress, aRequest, aLocation, aFlag) {
    this.updateButton(aLocation);
  },

  onClickButton: function(aEvent) {
    this.openExplorerOrSave(this.tabBrowser.selectedTab.linkedBrowser.currentURI.spec, 
                            aEvent.ctrlKey || aEvent.metaKey);
  },

  addButton: function() {
    let document = this.tabBrowser.ownerDocument;
    let button = document.createElement("image");
    button.setAttribute("id", "esrc-explorer-button");
    button.setAttribute("class", "urlbar-icon");
    button.setAttribute("tooltiptext", "Explore extension source\n(hold Ctrl to download)");
    button.setAttribute("onclick", "gBrowser.ESrcExplorer.onClickButton(event);"); 
    let urlBarIcons = document.getElementById("urlbar-icons");
    urlBarIcons.insertBefore(button, urlBarIcons.firstChild);
    this.button = button;
    this.updateButton(this.tabBrowser.selectedTab.linkedBrowser.currentURI);
    this.tabBrowser.addProgressListener(this);
  },

  removeButton: function() {
    this.tabBrowser.removeProgressListener(this);
    this.button.parentNode.removeChild(this.button);
    this.button = null;
  },

  onClickContext: function(aEvent) {
    let citem = this.browserWindow.document.getElementById("esrc-explorer-item");
    this.openExplorerOrSave(citem.getAttribute("data-url"), aEvent.ctrlKey || aEvent.metaKey);
  },

  popupShowing: function() {
    let mrw = Services.wm.getMostRecentWindow("navigator:browser");
    let citem = mrw.document.getElementById("esrc-explorer-item");
    citem.hidden = true;
    if (mrw.gContextMenu.linkURL) {
      let srcURI = Services.io.newURI(mrw.gContextMenu.linkURL, null, null);
      if (mrw.gBrowser.ESrcExplorer.targetUrlMatchPattern.matches(srcURI)) {
        citem.setAttribute("data-url", mrw.gContextMenu.linkURL);
        citem.hidden = false;
      }
    }
  },

  addContext: function() {
    this.targetUrlMatchPattern = new MatchPattern([
      '*://*/*.crx*', '*://*/*.CRX*',
      '*://*/*.nex*', '*://*/*.NEX*',
      '*://*/*.xpi*', '*://*/*.XPI*',
      cws_match_pattern, ows_match_pattern,
      amo_match_patterns[0], amo_match_patterns[1], 
      amo_file_version_match_pattern, apmo_match_pattern,
    ]);
    let cmenu = this.browserWindow.document.getElementById("contentAreaContextMenu");
    let citem = this.browserWindow.document.createElement("menuitem");
    citem.setAttribute("id", "esrc-explorer-item");
    citem.setAttribute("class", "menuitem-iconic");
    citem.setAttribute("label", "Explore linked extension source");
    citem.setAttribute("onclick", "gBrowser.ESrcExplorer.onClickContext(event);"); 
    cmenu.appendChild(citem);
    cmenu.addEventListener("popupshowing", this.popupShowing, false);
  },

  removeContext: function() {
    let cmenu = this.browserWindow.document.getElementById("contentAreaContextMenu");
    cmenu.removeEventListener("popupshowing", this.popupShowing);
    let citem = this.browserWindow.document.getElementById("esrc-explorer-item");
    cmenu.removeChild(citem);
    this.targetUrlMatchPattern = null;
  },
};

function BrowserWindowObserver(aHandlers) {
  this.handlers = aHandlers;
 }

BrowserWindowObserver.prototype = {
  observe: function(aSubject, aTopic, aData) {
    if (aTopic == "domwindowopened") {
      aSubject.QueryInterface(Ci.nsIDOMWindow).addEventListener("load", this, false);
    } else if (aTopic == "domwindowclosed") {
      if (aSubject.document.documentElement.getAttribute("windowtype") == "navigator:browser") {
        this.handlers.onShutdown(aSubject);
      }
    }
  },
  handleEvent: function(aEvent) {
    let aWindow = aEvent.currentTarget;
    aWindow.removeEventListener(aEvent.type, this, false);

    if (aWindow.document.documentElement.getAttribute("windowtype") == "navigator:browser") {
      this.handlers.onStartup(aWindow);
    }
  }
};

function browserWindowStartup(aWindow) {
  navigator = aWindow.navigator;
  aWindow.gBrowser || aWindow.getBrowser();
  aWindow.gBrowser.ESrcExplorer = new ESrcExplorer(aWindow);
}

function browserWindowShutdown(aWindow) {
  aWindow.gBrowser.ESrcExplorer.done();
  delete aWindow.gBrowser.ESrcExplorer;
}

var esrcexplorerObserver = {
  observe: function(aSubject, aTopic, aData) {
    if (aData == "Run") {
      let mrw = Services.wm.getMostRecentWindow("navigator:browser");
      let newtab = mrw.gBrowser.addTab("chrome://esrc-explorer/content/crxviewer.html", {relatedToCurrent: true})
      mrw.gBrowser.moveTabTo(newtab, mrw.gBrowser.tabContainer.selectedIndex + 1);
      mrw.gBrowser.selectedTab = newtab;
    }
  }
};

function startup(aData, aReason) {
  let defaultBranch = Services.prefs.getDefaultBranch(branch);
  defaultBranch.setCharPref("simpleStorage", "{}");
  defaultBranch.setBoolPref("showButton", true);
  defaultBranch.setBoolPref("showContext", true);

  Cu.import("chrome://esrc-explorer/content/MatchPattern.jsm");

  Services.scriptloader.loadSubScript("chrome://esrc-explorer/content/chrome-platform-info.js");
  Services.scriptloader.loadSubScript("chrome://esrc-explorer/content/cws_pattern.js");

  if (!styleSheetService.sheetRegistered(styleSheetURI, styleSheetService.USER_SHEET)) {
    styleSheetService.loadAndRegisterSheet(styleSheetURI, styleSheetService.USER_SHEET);
  }

  Services.obs.addObserver(esrcexplorerObserver, "esrcexplorerEvent", false);

  gWindowListener = new BrowserWindowObserver({
    onStartup: browserWindowStartup,
    onShutdown: browserWindowShutdown
  });
  Services.ww.registerNotification(gWindowListener);

  let winenu = Services.wm.getEnumerator("navigator:browser");
  while (winenu.hasMoreElements()) {
    browserWindowStartup(winenu.getNext());
  }
}

function shutdown(aData, aReason) {
  if (aReason == APP_SHUTDOWN) return;

  Services.ww.unregisterNotification(gWindowListener);
  gWindowListener = null;
  navigator = null;

  let winenu = Services.wm.getEnumerator("navigator:browser");
  while (winenu.hasMoreElements()) {
    browserWindowShutdown(winenu.getNext());
  }

  Services.obs.removeObserver(esrcexplorerObserver, "esrcexplorerEvent");

  if (styleSheetService.sheetRegistered(styleSheetURI, styleSheetService.USER_SHEET)) {
    styleSheetService.unregisterSheet(styleSheetURI, styleSheetService.USER_SHEET);
  }

  Cu.unload("chrome://esrc-explorer/content/MatchPattern.jsm");
}

function install(aData, aReason) {}
function uninstall(aData, aReason) {}
