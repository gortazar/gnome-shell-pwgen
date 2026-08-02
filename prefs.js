// SPDX-FileCopyrightText: 2026 Patxi Gortázar
// SPDX-License-Identifier: GPL-2.0-or-later
//
// This program is free software; you can redistribute it and/or modify it under
// the terms of the GNU General Public License as published by the Free Software
// Foundation; either version 2 of the License, or (at your option) any later
// version. See the LICENSE file for the full text.

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class PwgenGeneratorPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // Create the preferences page
        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'dialog-settings-symbolic'
        });
        window.add(page);

        // Create the settings group
        const group = new Adw.PreferencesGroup({
            title: 'Password Parameters',
            description: 'Configure default parameters for generated passwords'
        });
        page.add(group);

        // Password Length (SpinRow)
        const lengthAdjustment = new Gtk.Adjustment({
            lower: 4,
            upper: 128,
            step_increment: 1,
            page_increment: 10,
            value: settings.get_int('password-length')
        });
        const lengthRow = new Adw.SpinRow({
            title: 'Password Length',
            subtitle: 'Length of the generated password(s)',
            adjustment: lengthAdjustment,
            snap_to_ticks: true,
            numeric: true
        });
        settings.bind('password-length', lengthAdjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(lengthRow);

        // Use Numbers (SwitchRow)
        const numbersRow = new Adw.SwitchRow({
            title: 'Use Numbers',
            subtitle: 'Include numbers in the password',
            active: settings.get_boolean('use-numbers')
        });
        settings.bind('use-numbers', numbersRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(numbersRow);

        // Use Symbols (SwitchRow)
        const symbolsRow = new Adw.SwitchRow({
            title: 'Use Symbols',
            subtitle: 'Include special non-alphabetic symbols',
            active: settings.get_boolean('use-symbols')
        });
        settings.bind('use-symbols', symbolsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(symbolsRow);

        // Number of Passwords (SpinRow)
        const countAdjustment = new Gtk.Adjustment({
            lower: 1,
            upper: 50,
            step_increment: 1,
            page_increment: 5,
            value: settings.get_int('num-passwords')
        });
        const countRow = new Adw.SpinRow({
            title: 'Number of Passwords',
            subtitle: 'How many passwords to generate',
            adjustment: countAdjustment,
            snap_to_ticks: true,
            numeric: true
        });
        settings.bind('num-passwords', countAdjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(countRow);
    }
}
