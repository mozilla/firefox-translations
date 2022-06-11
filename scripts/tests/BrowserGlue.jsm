  // Set up a listener to enable/disable the translation extension
  // based on its preference.
  _monitorTranslationsPref() {
    const PREF = "extensions.translations.disabled";
    const ID = "firefox-translations-addon@mozilla.org";
    const oldID = "firefox-infobar-ui-bergamot-browser-extension@browser.mt";

    // First, try to uninstall the old extension, if exists.
    (async () => {
      let addon = await lazy.AddonManager.getAddonByID(oldID);
      if (addon) {
        addon.uninstall().catch(Cu.reportError);
      }
    })();

    const _checkTranslationsPref = async () => {
      let addon = await lazy.AddonManager.getAddonByID(ID);
      let disabled = Services.prefs.getBoolPref(PREF, false);
      if (!addon && disabled) {
        // not installed, bail out early.
        return;
      }
      if (!disabled) {
        // first time install of addon and install on firefox update
        addon =
          (await lazy.AddonManager.maybeInstallBuiltinAddon(
            ID,
            {version},
            "resource://builtin-addons/translations/"
          )) || addon;
        await addon.enable();
      } else if (addon) {
        await addon.disable();
      }
    };
    Services.prefs.addObserver(PREF, _checkTranslationsPref);
    _checkTranslationsPref();
  },