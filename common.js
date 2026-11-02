// Shell-free helpers shared by extension.js (gnome-shell process), prefs.js
// (GTK process) and tests/. Import only gi://GLib and gi://Gio here: this file
// must load in both processes and under plain `gjs -m`.

export const SETTINGS_COMPACT_MODE = 'compact-mode';
export const SETTINGS_REFRESH_RATE = 'refresh-rate';
export const SETTINGS_POSITION = 'position-in-panel';
export const SETTINGS_SHOW_MAP = 'show-map';
export const SETTINGS_SHOW_CIDR = 'show-cidr-prefix';
export const SETTINGS_HIDDEN_IFACES = 'hidden-interfaces';
export const SETTINGS_NOTIFY_IP_CHANGE = 'notify-ip-change';
export const SETTINGS_COPY_CIDR = 'copy-cidr';

// Built-in ignored interface prefixes (containers, virtual bridges, loopback)
export const IGNORED_IFACE_PREFIXES = ['docker', 'br-', 'veth', 'virbr', 'lo'];

// Parse `ip -o addr show scope global` into Map<iface, [{ip, cidr, isV6}]>
export function parseIpAddr(stdout) {
    const ifaces = new Map();
    for (const line of (stdout || '').split('\n')) {
        if (!line.trim())
            continue;

        const parts = line.trim().split(/\s+/);
        const iface = parts[1];
        if (!iface || IGNORED_IFACE_PREFIXES.some(p => iface.startsWith(p)))
            continue;

        const isV6 = parts[2] === 'inet6';
        const cidr = parts[3] || ''; // e.g. "192.168.1.5/24"
        const ip = cidr.split('/')[0];
        if (!ip)
            continue;

        if (!ifaces.has(iface))
            ifaces.set(iface, []);
        ifaces.get(iface).push({ip, cidr, isV6});
    }
    return ifaces;
}

// Detect VPN provider from organization/ASN name
export const VPN_SIGNATURES = [
    // -- Direct VPN providers --
    ['proton', 'Proton VPN'],
    ['nordvpn', 'NordVPN'],
    ['tefincom', 'NordVPN'],
    ['packethub', 'NordVPN'],
    ['nordlayer', 'NordLayer'],
    ['expressvpn', 'ExpressVPN'],
    ['express vpn', 'ExpressVPN'],
    ['surfshark', 'Surfshark'],
    ['cyberzone', 'Surfshark'],
    ['cyberghost', 'CyberGhost'],
    ['private internet access', 'PIA'],
    ['ivpn', 'IVPN'],
    ['mullvad', 'Mullvad VPN'],
    ['windscribe', 'Windscribe'],
    ['hide.me', 'hide.me'],
    ['eventure', 'hide.me'],
    ['torguard', 'TorGuard'],
    ['vyprvpn', 'VyprVPN'],
    ['golden frog', 'VyprVPN'],
    ['giganews', 'VyprVPN'],
    ['azirevpn', 'AzireVPN'],
    ['netbouncer', 'AzireVPN'],
    ['airvpn', 'AirVPN'],
    ['paolo brini', 'AirVPN'],
    ['perfect privacy', 'Perfect Privacy'],
    ['ipvanish', 'IPVanish'],
    ['netprotect', 'IPVanish'],
    ['hotspot shield', 'Hotspot Shield'],
    ['anchorfree', 'Hotspot Shield'],
    ['pango', 'Hotspot Shield'],
    ['tunnelbear', 'TunnelBear'],
    ['purevpn', 'PureVPN'],
    ['gz systems', 'PureVPN'],
    ['strongvpn', 'StrongVPN'],
    ['privadovpn', 'PrivadoVPN'],
    ['privado networks', 'PrivadoVPN'],
    ['ovpn', 'OVPN'],
    ['hidemyass', 'HMA'],
    ['privax', 'HMA'],
    ['njalla', 'Njalla VPN'],
    ['1337 services', 'Njalla VPN'],
    ['kaspersky', 'Kaspersky VPN'],
    ['bitdefender', 'Bitdefender VPN'],
    ['norton', 'Norton VPN'],
    ['avast', 'Avast SecureLine'],
    ['avira', 'Avira VPN'],
    ['astrill', 'Astrill VPN'],
    ['cryptostorm', 'Cryptostorm'],
    ['vpn.ac', 'VPN.ac'],
    ['privatevpn', 'PrivateVPN'],
    ['pvdatanet', 'PrivateVPN'],
    ['cactusvpn', 'CactusVPN'],
    ['cactus vpn', 'CactusVPN'],
    ['zenmate', 'ZenMate'],
    ['psiphon', 'Psiphon'],
    ['keepsolid', 'VPN Unlimited'],
    ['speedify', 'Speedify'],
    ['ivacy', 'Ivacy VPN'],
    // -- High-confidence VPN infrastructure --
    ['m247', 'VPN/Datacenter'],
    ['datacamp', 'VPN/Datacenter'],
    ['31173 services', 'VPN/Datacenter'],
    ['tzulo', 'VPN/Datacenter'],
    ['datapacket', 'VPN/Datacenter'],
    ['100tb', 'VPN/Datacenter'],
    ['obehosting', 'VPN/Datacenter'],
    ['clouvider', 'VPN/Datacenter'],
    ['hydra communications', 'VPN/Datacenter'],
    ['internet vikings', 'VPN/Datacenter'],
    ['blix', 'VPN/Datacenter'],
    ['intergrid', 'VPN/Datacenter'],
    ['invite systems', 'VPN/Datacenter'],
    ['creanova', 'VPN/Datacenter'],
    ['xtom', 'VPN/Datacenter'],
    ['quadranet', 'VPN/Datacenter'],
    ['zenlayer', 'VPN/Datacenter'],
    ['stark industries', 'VPN/Datacenter'],
    ['free range cloud', 'VPN/Datacenter'],
];

export function detectVpnProvider(orgLower) {
    for (const [pattern, name] of VPN_SIGNATURES) {
        if (orgLower.includes(pattern))
            return name;
    }
    return null;
}

// Country name -> ISO 3166-1 alpha-2 code, for the flag icons
const FLAG_CODES = [
    'AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW',
    'AX','AZ','BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN',
    'BO','BQ','BR','BS','BT','BV','BW','BY','BZ','CA','CC','CD','CF','CG',
    'CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ',
    'DE','DJ','DK','DM','DO','DZ','EC','EE','EG','EH','ER','ES','ET','FI',
    'FJ','FK','FM','FO','FR','GA','GB','GD','GE','GF','GG','GH','GI','GL',
    'GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY','HK','HM','HN','HR',
    'HT','HU','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT','JE','JM',
    'JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ','LA',
    'LB','LC','LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME',
    'MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU',
    'MV','MW','MX','MY','MZ','NA','NC','NE','NF','NG','NI','NL','NO','NP',
    'NR','NU','NZ','OM','PA','PE','PF','PG','PH','PK','PL','PM','PN','PR',
    'PS','PT','PW','PY','QA','RE','RO','RS','RU','RW','SA','SB','SC','SD',
    'SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV',
    'SX','SY','SZ','TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO',
    'TR','TT','TV','TW','TZ','UA','UG','UM','US','UY','UZ','VA','VC','VE',
    'VG','VI','VN','VU','WF','WS','YE','YT','ZA','ZM','ZW',
];

const COUNTRY_TO_CODE = {};
// Mullvad returns country names only (no ISO code). Long names first so a short
// alias never overwrites one; short style adds "Hong Kong", "Macao", "Myanmar",
// "Palestine" and "Bosnia", which is how Mullvad spells them.
for (const style of ['long', 'short']) {
    try {
        const regionNames = new Intl.DisplayNames(['en'], {type: 'region', style});
        for (const code of FLAG_CODES) {
            try {
                const name = regionNames.of(code);
                if (name && !(name in COUNTRY_TO_CODE))
                    COUNTRY_TO_CODE[name] = code;
            } catch (_e) { /* skip unknown codes */ }
        }
    } catch (_e) { /* Intl.DisplayNames not available */ }
}

export function countryCode(name) {
    return (name && COUNTRY_TO_CODE[name]) || null;
}

export function latLonToTile(lat, lon, zoom) {
    const n = Math.pow(2, zoom);
    const x = Math.floor((lon + 180) / 360 * n);
    const latRad = lat * Math.PI / 180;
    const y = Math.floor(
        (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n
    );
    return {x, y};
}

export function describeResolvers(resolvers) {
    if (!Array.isArray(resolvers) || resolvers.length === 0)
        return 'DNS: no resolvers reported';

    if (resolvers.every(r => r?.mullvad_dns === true)) {
        const n = resolvers.length;
        return `DNS: ${n} resolver${n > 1 ? 's' : ''}, all Mullvad`;
    }

    // ponytail: "all Mullvad" is the only verdict this API actually proves.
    // Everything else is reported as-is rather than guessed at - a resolver
    // in another country is normal for anycast and must not cry leak.
    // Upgrade path: compare against the exit country if false alarms prove rare.
    const seen = [];
    for (const r of resolvers) {
        const who = r?.organization || r?.hostname || r?.ip || 'unknown';
        const where = r?.country ? ` (${r.country})` : '';
        const entry = `${who}${where}`;
        if (!seen.includes(entry))
            seen.push(entry);
    }
    return `DNS: ${seen.join(', ')}`;
}

// Security status levels
export const STATUS_PROTECTED = 'protected';
export const STATUS_LEAK = 'leak';
export const STATUS_EXPOSED = 'exposed';
export const STATUS_OFFLINE = 'offline';

// A family is "in the VPN" when its traffic leaves through a local tunnel
// interface (`tunnels.vN`, from the route check) or Mullvad's remote view of its
// exit IP says VPN. A leak is one family inside and the other outside.
export function assessSecurity(ipv4Data, ipv6Data, tunnels = {v4: null, v6: null}) {
    if (!ipv4Data && !ipv6Data)
        return {status: STATUS_OFFLINE, icon: 'network-offline-symbolic', text: 'No connection'};

    const families = [['IPv4', ipv4Data, tunnels?.v4], ['IPv6', ipv6Data, tunnels?.v6]]
        .filter(([, data]) => data)
        .map(([family, data, tunnel]) => {
            const remote = data.mullvad_exit_ip === true
                ? 'Mullvad VPN'
                : detectVpnProvider((data.organization || '').toLowerCase());
            return {family, data, tunnel, remote, inVpn: !!tunnel || !!remote};
        });

    const remoteFamily = families.find(f => f.remote);
    const tunnelFamily = families.find(f => f.tunnel);
    const vpnProvider = remoteFamily?.remote
        ?? (tunnelFamily ? `VPN (${tunnelFamily.tunnel})` : null);

    if (families.length === 2 && families[0].inVpn !== families[1].inVpn) {
        const outside = families.find(f => !f.inVpn);
        return {
            status: STATUS_LEAK,
            icon: 'dialog-warning-symbolic',
            text: `${outside.family} Leak — ${outside.family} via ${outside.data.organization || 'ISP'}`,
            vpnProvider,
            leakFamily: outside.family,
        };
    }

    if (families.every(f => f.inVpn)) {
        let text = vpnProvider;
        if (remoteFamily?.data.mullvad_exit_ip === true) {
            const relay = remoteFamily.data.mullvad_exit_ip_hostname || '';
            const stype = remoteFamily.data.mullvad_server_type || '';
            if (relay) text += ` (${relay})`;
            if (stype) text += ` [${stype}]`;
        }
        return {status: STATUS_PROTECTED, icon: 'security-high-symbolic', text, vpnProvider};
    }

    return {
        status: STATUS_EXPOSED,
        icon: 'security-low-symbolic',
        text: `Direct — ${(ipv4Data || ipv6Data).organization || 'unknown ISP'}`,
    };
}

// Local route check parsers. Both return null/empty on bad input, never throw.

// Device from `ip -j route get <addr>` output
export function routeDevice(json) {
    try {
        const dev = JSON.parse(json)?.[0]?.dev;
        return typeof dev === 'string' && dev ? dev : null;
    } catch (_e) {
        return null;
    }
}

// Tunnel interface names from `ip -j -d link show` output
export function tunnelInterfaces(json) {
    const names = new Set();
    try {
        for (const link of JSON.parse(json)) {
            if (['wireguard', 'tun', 'xfrm'].includes(link?.linkinfo?.info_kind) && link.ifname)
                names.add(link.ifname);
        }
    } catch (_e) { /* bad input: no tunnels */ }
    return names;
}
