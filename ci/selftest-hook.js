// Appended by ci/smoke-test.sh to the *installed copy* of extension.js. Not part
// of the extension proper -- the repository file is never modified.
//
// The shell's Eval D-Bus method is locked behind unsafe mode, which cannot be
// turned on from outside the shell, so there is no way to click the menu item
// from CI. Instead this triggers the real _generatePassword() from inside the
// shell and prints the outcome, which the smoke test greps out of the log.
//
// The imports below are the hook's own, under names extension.js does not use.
// Borrowing its bindings instead looks tidier and breaks the moment extension.js
// stops needing one of them: this file used to rely on its GLib import, and
// dropping that turned every shell job red with a ReferenceError. Declaring an
// import twice in the one module the two files share would be just as fatal,
// hence the prefixed names. ESM hoists imports, so appearing at the end of the
// module is fine. tests/ci-hook-test.js keeps both properties honest.
import SelfTestGLib from 'gi://GLib';
import * as SelfTestMain from 'resource:///org/gnome/shell/ui/main.js';

if (SelfTestGLib.getenv('PWGEN_SELFTEST')) {
    SelfTestGLib.timeout_add_seconds(SelfTestGLib.PRIORITY_DEFAULT, 3, () => {
        const indicator = SelfTestMain.panel.statusArea['pwgen-generator@pwgen-gs.patxi'];
        if (!indicator) {
            console.log('PWGEN_SELFTEST result=no-indicator');
            return SelfTestGLib.SOURCE_REMOVE;
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
                disableDuringGeneration();
            })
            .catch(e => console.log(`PWGEN_SELFTEST result=threw ${e}`));

        return SelfTestGLib.SOURCE_REMOVE;
    });

    // Second scenario: disable the extension while a generation is in flight.
    // Generation is asynchronous, so the shell can tear the menu down underneath
    // it, and a continuation that then updates the menu touches disposed St
    // objects -- a stack of Gjs-CRITICALs in the journal, which is a review
    // finding waiting to happen. smoke-test.sh greps the log for those, so all
    // this has to do is create the situation and say when it is over.
    function disableDuringGeneration() {
        const uuid = 'pwgen-generator@pwgen-gs.patxi';
        const indicator = SelfTestMain.panel.statusArea[uuid];
        if (!indicator) {
            console.log('PWGEN_SELFTEST race=no-indicator');
            return;
        }

        indicator._generatePassword()
            .then(() => console.log('PWGEN_SELFTEST race=settled'))
            .catch(e => console.log(`PWGEN_SELFTEST race=threw ${e}`));

        // Same tick: the read on /dev/urandom cannot have completed yet.
        SelfTestMain.extensionManager.disableExtension(uuid);

        // Give the cancelled generation time to come back and misbehave before
        // the run is declared over.
        SelfTestGLib.timeout_add_seconds(SelfTestGLib.PRIORITY_DEFAULT, 3, () => {
            console.log('PWGEN_SELFTEST race=done');
            return SelfTestGLib.SOURCE_REMOVE;
        });
    }
}
