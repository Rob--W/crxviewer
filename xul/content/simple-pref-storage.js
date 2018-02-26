Components.utils.import("resource://gre/modules/Services.jsm");

var prefStorage = JSON.parse(Services.prefs.getCharPref("extensions.esrc-explorer.simpleStorage"));

var simpleStorage = {
  getItem: function(aItem) {
    return prefStorage[aItem];
  },
  setItem: function(aItem, aValue) {
    prefStorage[aItem] = aValue;
    Services.prefs.setCharPref("extensions.esrc-explorer.simpleStorage", JSON.stringify(prefStorage));
  },
}