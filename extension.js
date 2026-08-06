// SPDX-FileCopyrightText: 2026 Patxi Gortázar <patxi.gortazar@gmail.com>
// SPDX-License-Identifier: GPL-2.0-or-later
//
// This program is free software; you can redistribute it and/or modify it under
// the terms of the GNU General Public License as published by the Free Software
// Foundation; either version 2 of the License, or (at your option) any later
// version. See the LICENSE file for the full text.

import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { generateMany } from './lib/generator.js';

const PwgenIndicator = GObject.registerClass(
class PwgenIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Password Generator');
        this._extension = extension;
        this._settings = extension.getSettings();

        // Generation is asynchronous and disable() can land in the middle of one.
        // Cancelling on destroy tears down the outstanding read on /dev/urandom
        // and tells the continuation below that its menu is gone; without it the
        // promise resolves into a disposed St.BoxLayout and the journal fills with
        // "has been already disposed" criticals.
        //
        // A ::destroy handler rather than an overridden destroy(): the signal is
        // emitted however the actor dies, including from C.
        this._cancellable = new Gio.Cancellable();
        this.connect('destroy', () => {
            this._cancellable.cancel();
        });

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
        const numPasswords = this._settings.get_int('num-passwords');

        // Letters are always in play, mirroring what `pwgen -s` produced when
        // generation still went through the external binary; the two switches
        // only add digits and symbols on top.
        const classes = {
            lowercase: true,
            uppercase: true,
            digits: this._settings.get_boolean('use-numbers'),
            symbols: this._settings.get_boolean('use-symbols'),
        };

        // Held in a local: the continuation still has to know why it was woken,
        // and by then `this` may be a destroyed object.
        const cancellable = this._cancellable;

        try {
            const passwords = await generateMany({
                length,
                classes,
                count: numPasswords,
                cancellable,
            });

            // The extension may have been disabled while the entropy was being
            // read. Nothing below is safe then, and a password nobody is waiting
            // for any more should not reach the clipboard either.
            if (cancellable.is_cancelled())
                return;

            // Copy to clipboard
            this._copyToClipboard(passwords.join('\n'));

            // Notify user
            Main.notify('Password Generator', 'Password(s) copied to clipboard.');

            // Update recent passwords list in the menu
            this._updateHistory(passwords);
        } catch (error) {
            // Cancellation is teardown, not a failure: it is what disable() looks
            // like from in here, and there is nobody left to notify.
            if (cancellable.is_cancelled())
                return;

            // Never a weaker password on failure: the generator refuses rather
            // than falling back, and the user is told nothing was produced.
            console.error('Password Generator Error:', error);
            Main.notify('Password Generator Error',
                `Failed to generate password: ${error.message || error}`);
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

        // The password itself is never used as a label: the menu sits in the top
        // panel, where it is visible to anyone looking at the screen and to
        // screen sharing and recording. Items are numbered instead, and the value
        // is only reachable through the clipboard.
        passwords.forEach((password, index) => {
            const item = new PopupMenu.PopupImageMenuItem(
                `Password ${index + 1}`, 'edit-copy-symbolic');
            item.connect('activate', () => {
                this._copyToClipboard(password);
                Main.notify('Password Copied', `Password ${index + 1} copied to clipboard.`);
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
