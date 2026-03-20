# Public IP Address — GNOME Shell Extension

Shows your public IP address with VPN detection, IPv6 leak warnings, and a security status banner in the GNOME Shell panel.

## Features

- **Public IP display** — IPv4 and IPv6 from Mullvad's API (privacy-first, no-log)
- **Local IP display** — grouped by network interface, click to copy
- **VPN detection** — Mullvad (confirmed), 40+ other providers (heuristic)
- **Security banner** — green (VPN active), yellow (exposed), red (IPv6 leak)
- **IP change notifications** — opt-in alerts with VPN status context
- **Country flag** — in panel and popup
- **Map tile** — opt-in, from OpenStreetMap
- **CIDR prefix** — opt-in, from RIPE NCC

## Requirements

- GNOME Shell 45, 46, or 47

## Install

### From source

    make install

Then restart GNOME Shell (log out/in on Wayland, Alt+F2 r on X11).

### Manual

    make zip
    gnome-extensions install public-ip-address@holdingitwrong.com.zip

## Privacy

The extension contacts these services:

| Service                                | Data sent            | When                | Opt-out                                  |
| -------------------------------------- | -------------------- | ------------------- | ---------------------------------------- |
| Mullvad API (am.i.mullvad.net)         | Source IP (implicit) | Every refresh cycle | Cannot disable (core function)           |
| OpenStreetMap (tile.openstreetmap.org) | Lat/lon in tile URL  | On IP change        | Preferences > Privacy > Show map tile    |
| RIPE NCC (stat.ripe.net)               | IP as URL parameter  | On IP change        | Preferences > Privacy > Show CIDR prefix |

## Credits

- Flag icons: GoSquared
- Original extension: growing/gnome-public-ip-extension

## License

GPL-2.0-or-later
