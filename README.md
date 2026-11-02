# Public IP Address — GNOME Shell Extension

Shows your public IP address with VPN detection, IPv6 leak warnings, and a security status banner in the GNOME Shell panel.

## Features

- **Public IP display** — IPv4 and IPv6 from Mullvad's API (privacy-first, no-log)
- **Local IP display** — grouped by network interface, click to copy
- **VPN detection** — Mullvad (confirmed), 40+ other providers (heuristic)
- **Security banner** — green (VPN active), yellow (exposed), red (IPv4/IPv6 leak: one family inside the VPN, the other outside)
- **Panel status dot** — same colour in the top bar, so a leak is visible without opening the menu
- **Live network updates** — refreshes within seconds of a VPN connecting or dropping, not on the next poll
- **DNS leak test** — on demand, shows which resolvers actually answered for you
- **Blocklist warning** — flags a public IP listed on spam/abuse blocklists
- **IP change notifications** — opt-in alerts with VPN status context
- **Country flag** — in panel and popup
- **Map tile** — opt-in, from OpenStreetMap
- **CIDR prefix** — opt-in, from RIPE NCC

## Requirements

- GNOME Shell 45, 46, 47, or 48

## Install

### From source

    make install

Then restart GNOME Shell (log out/in on Wayland, Alt+F2 r on X11).

### Manual

    make pack
    gnome-extensions install dist/public-ip-address@theophilediot.github.io.shell-extension.zip

## Release

Source releases are tracked in [`VERSION`](VERSION) and Git tags such as `v0.1.1`. The GNOME Extensions website assigns its own internal version, so `metadata.json` intentionally does not contain a `version` key.

Run the release checks before tagging:

    make release-check

See [`RELEASE.md`](RELEASE.md) for the full workflow.

## Privacy

The extension contacts these services:

| Service                                | Data sent            | When                | Opt-out                                  |
| -------------------------------------- | -------------------- | ------------------- | ---------------------------------------- |
| Mullvad API (am.i.mullvad.net)         | Source IP (implicit) | Every refresh cycle | Cannot disable (core function)           |
| OpenStreetMap (tile.openstreetmap.org) | Lat/lon in tile URL  | On IP change        | Preferences > Privacy > Show map tile    |
| RIPE NCC (stat.ripe.net)               | IP as URL parameter  | On IP change        | Preferences > Privacy > Show CIDR prefix |
| Mullvad DNS leak check (`<random>.dnsleak.am.i.mullvad.net`, `am.i.mullvad.net`) | A DNS lookup of the random name (no HTTPS request to that host), then your source IP (implicit) to `am.i.mullvad.net` for the result | Only when you click **Test DNS leak** | Don't click it |

The DNS leak test works by making *your* system resolver look up a hostname Mullvad controls (a plain lookup, no HTTP request, so a configured HTTP proxy is bypassed on purpose) — that disclosure is inherent to the test, which is why it never runs on its own.

The map tile is held in memory only; nothing is written to disk. Local routing and interface checks (`ip route get`, `ip link`) run on your machine and send no packets.

## Credits

- Flag icons: GoSquared
- Original extension: growing/gnome-public-ip-extension

## License

GPL-2.0-or-later
