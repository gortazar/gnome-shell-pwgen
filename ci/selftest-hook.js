// Appended by ci/smoke-test.sh to the *installed copy* of extension.js. Not part
// of the extension proper -- the repository file is never modified.
//
// The shell's Eval D-Bus method is locked behind unsafe mode, which cannot be
// turned on from outside the shell, so there is no way to click the menu item
// from CI. Instead this triggers the real _generatePassword() from inside the
// shell and prints the outcome, which the smoke test greps out of the log.
//
// GLib and Main are already imported by extension.js above.
if (GLib.getenv('PWGEN_SELFTEST')) {
    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, () => {
        const indicator = Main.panel.statusArea['pwgen-generator@pwgen-gs.patxi'];
        if (!indicator) {
            console.log('PWGEN_SELFTEST result=no-indicator');
            return GLib.SOURCE_REMOVE;
        }

        indicator._generatePassword()
            .then(() => {
                // _generatePassword catches its own errors, so resolving proves
                // nothing. The history list is the evidence: item 1 is the header,
                // anything beyond it is an actual password.
                const items = indicator._historySection._getMenuItems().length;
                const count = Math.max(0, items - 1);
                console.log(`PWGEN_SELFTEST result=${count > 0 ? 'ok' : 'no-passwords'} ` +
                    `passwords=${count}`);
            })
            .catch(e => console.log(`PWGEN_SELFTEST result=threw ${e}`));

        return GLib.SOURCE_REMOVE;
    });
}
