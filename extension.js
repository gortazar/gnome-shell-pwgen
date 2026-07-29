import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

// GNOME Shell does not promisify this for us, so `await proc.communicate_utf8_async()`
// would throw before pwgen's output is ever read. Safe to call repeatedly.
Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

const PwgenIndicator = GObject.registerClass(
class PwgenIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Password Generator');
        this._extension = extension;
        this._settings = extension.getSettings();

        // 1. Icon in panel
        this.icon = new St.Icon({
            icon_name: 'dialog-password-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(this.icon);

        // 2. Header
        const titleItem = new PopupMenu.PopupMenuItem('Password Generator', {
            reactive: false
        });
        titleItem.label.style = 'font-weight: bold;';
        this.menu.addMenuItem(titleItem);

        // Separator
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // 3. Generate & Copy button
        const generateItem = new PopupMenu.PopupImageMenuItem('Generate & Copy', 'system-run-symbolic');
        generateItem.connect('activate', () => {
            this._generatePassword();
        });
        this.menu.addMenuItem(generateItem);

        // Separator
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // 4. History/List Section (where generated passwords will show up)
        this._historySection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._historySection);

        // Separator (only shown when history is visible)
        this._separatorBeforeSettings = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._separatorBeforeSettings);

        // 5. Preferences button
        const settingsItem = new PopupMenu.PopupImageMenuItem('Preferences...', 'preferences-system-symbolic');
        settingsItem.connect('activate', () => {
            this._extension.openPreferences();
        });
        this.menu.addMenuItem(settingsItem);

        // Hide history by default
        this._historySection.actor.visible = false;
        this._separatorBeforeSettings.actor.visible = false;
    }

    async _generatePassword() {
        const length = this._settings.get_int('password-length');
        const useNumbers = this._settings.get_boolean('use-numbers');
        const useSymbols = this._settings.get_boolean('use-symbols');
        const numPasswords = this._settings.get_int('num-passwords');

        // Build pwgen arguments
        // -s: secure
        // -1: one per line
        const args = ['pwgen', '-s', '-1'];
        
        if (useNumbers) {
            args.push('-n');
        } else {
            args.push('-0');
        }

        if (useSymbols) {
            args.push('-y');
        }

        args.push(length.toString());
        args.push(numPasswords.toString());

        try {
            const proc = Gio.Subprocess.new(
                args,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );

            const [stdout, stderr] = await proc.communicate_utf8_async(null, null);

            if (proc.get_successful()) {
                const passwordsText = stdout.trim();
                if (!passwordsText) {
                    throw new Error('No output from pwgen');
                }

                // Copy to clipboard
                this._copyToClipboard(passwordsText);

                // Notify user
                Main.notify('Password Generator', 'Password(s) copied to clipboard.');

                // Update recent passwords list in the menu
                const passwords = passwordsText.split('\n').map(p => p.trim()).filter(Boolean);
                this._updateHistory(passwords);
            } else {
                throw new Error(stderr.trim() || 'Unknown error running pwgen');
            }
        } catch (error) {
            console.error('Password Generator Error:', error);
            
            let isNotFoundError = false;
            try {
                if (error.matches && (
                    error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND) ||
                    error.matches(GLib.SpawnError, GLib.SpawnError.NOENT)
                )) {
                    isNotFoundError = true;
                }
            } catch (e) {
                // Ignore matching error
            }

            const errorMsg = error.message || String(error);
            if (isNotFoundError || errorMsg.includes('pwgen') || errorMsg.includes('ENOENT') || errorMsg.includes('not found')) {
                Main.notify('Password Generator Error', 'pwgen is not installed. Please run "sudo apt install pwgen" to use this extension.');
            } else {
                Main.notify('Password Generator Error', `Failed to generate password: ${errorMsg}`);
            }
        }
    }

    // Sets the clipboard and reads it back, so a silent copy failure ends up in the
    // log instead of looking like success. Never logs the password itself.
    _copyToClipboard(text) {
        const clipboard = St.Clipboard.get_default();
        clipboard.set_text(St.ClipboardType.CLIPBOARD, text);

        clipboard.get_text(St.ClipboardType.CLIPBOARD, (_clipboard, readBack) => {
            if (readBack !== text) {
                console.warn('Password Generator: clipboard read-back mismatch ' +
                    `(wrote ${text.length} chars, read back ${readBack ? readBack.length : 0})`);
            }
        });
    }

    _updateHistory(passwords) {
        // Clear previous history
        this._historySection.removeAll();

        // Header for history section
        const historyHeader = new PopupMenu.PopupMenuItem('Generated Passwords (click to copy):', {
            reactive: false
        });
        historyHeader.label.style = 'font-size: 0.85em; font-weight: bold; color: #888; padding: 4px 6px;';
        this._historySection.addMenuItem(historyHeader);

        passwords.forEach(password => {
            const item = new PopupMenu.PopupImageMenuItem(password, 'edit-copy-symbolic');
            item.connect('activate', () => {
                this._copyToClipboard(password);
                Main.notify('Password Copied', `Copied: ${password}`);
            });
            this._historySection.addMenuItem(item);
        });

        // Show section and separator
        this._historySection.actor.visible = true;
        this._separatorBeforeSettings.actor.visible = true;
    }
});

export default class PwgenGeneratorExtension extends Extension {
    enable() {
        this._indicator = new PwgenIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
    }
}
