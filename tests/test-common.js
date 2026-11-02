// Unit tests for the Shell-free helpers in common.js.
// Run from the repository root: gjs -m tests/test-common.js

import System from 'system';

import {
    STATUS_EXPOSED, STATUS_LEAK, STATUS_OFFLINE, STATUS_PROTECTED,
    assessSecurity, countryCode, describeResolvers, latLonToTile,
    parseIpAddr, routeDevice, tunnelInterfaces,
} from '../common.js';

const failures = [];
let checks = 0;

function eq(actual, expected, label) {
    checks++;
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e)
        failures.push(`${label}: expected ${e}, got ${a}`);
}

const direct = (org, country = 'Germany') => ({ip: '203.0.113.7', organization: org, country});
const vpn = (org = 'M247 Europe SRL', country = 'Germany') => ({ip: '198.51.100.9', organization: org, country});
const mullvad = {
    ip: '198.51.100.20', organization: 'Mullvad VPN', country: 'Sweden',
    mullvad_exit_ip: true, mullvad_exit_ip_hostname: 'se-sto-wg-001', mullvad_server_type: 'WireGuard',
};

// --- assessSecurity ---------------------------------------------------------

let r = assessSecurity(null, null);
eq(r.status, STATUS_OFFLINE, 'offline: status');
eq(r.text, 'No connection', 'offline: text');

r = assessSecurity(direct('Example ISP'), null);
eq(r.status, STATUS_EXPOSED, 'v4 only direct: status');
eq(r.text, 'Direct — Example ISP', 'v4 only direct: text');

r = assessSecurity(mullvad, null);
eq(r.status, STATUS_PROTECTED, 'v4 mullvad: status');
eq(r.text, 'Mullvad VPN (se-sto-wg-001) [WireGuard]', 'v4 mullvad: text');
eq(r.vpnProvider, 'Mullvad VPN', 'v4 mullvad: provider');

r = assessSecurity(vpn(), direct('Example ISP'));
eq(r.status, STATUS_LEAK, 'v4 VPN org + v6 ISP: status');
eq(r.leakFamily, 'IPv6', 'v4 VPN org + v6 ISP: family');
eq(r.text, 'IPv6 Leak — IPv6 via Example ISP', 'v4 VPN org + v6 ISP: text');

r = assessSecurity(direct('Example ISP'), vpn());
eq(r.status, STATUS_LEAK, 'v4 ISP + v6 VPN org: status');
eq(r.leakFamily, 'IPv4', 'v4 ISP + v6 VPN org: family');
eq(r.text, 'IPv4 Leak — IPv4 via Example ISP', 'v4 ISP + v6 VPN org: text');

// Old rule called any country mismatch a leak; two direct families are just exposed
r = assessSecurity(direct('Example ISP', 'Germany'), direct('Other ISP', 'France'));
eq(r.status, STATUS_EXPOSED, 'both direct, different countries: status');
eq(r.leakFamily, undefined, 'both direct, different countries: no leak family');

r = assessSecurity(direct('Example ISP'), direct('Example ISP'), {v4: 'wg0', v6: null});
eq(r.status, STATUS_LEAK, 'v4 tunnelled locally, org unknown + v6 ISP: status');
eq(r.leakFamily, 'IPv6', 'v4 tunnelled locally + v6 ISP: family');
eq(r.vpnProvider, 'VPN (wg0)', 'v4 tunnelled locally: provider');

r = assessSecurity(direct('Example ISP'), direct('Example ISP'), {v4: 'wg0', v6: 'wg0'});
eq(r.status, STATUS_PROTECTED, 'both tunnelled: status');
eq(r.text, 'VPN (wg0)', 'both tunnelled: text');
eq(r.vpnProvider, 'VPN (wg0)', 'both tunnelled: provider');

r = assessSecurity(mullvad, {...mullvad, ip: '2001:db8::1'});
eq(r.status, STATUS_PROTECTED, 'both mullvad: status');

// --- parseIpAddr ------------------------------------------------------------

const ipAddr = [
    '1: lo    inet 127.0.0.1/8 scope host lo\\       valid_lft forever preferred_lft forever',
    '3: wlp0s20f3    inet 172.31.0.11/24 brd 172.31.0.255 scope global dynamic noprefixroute wlp0s20f3\\       valid_lft 79043sec',
    '3: wlp0s20f3    inet6 2001:db8::5/64 scope global dynamic noprefixroute \\       valid_lft 86000sec',
    '6: docker0    inet 172.17.0.1/16 brd 172.17.255.255 scope global docker0\\       valid_lft forever',
    '9: veth4b76829    inet6 fd00::1/64 scope global \\       valid_lft forever',
    '14: wt0    inet 100.64.0.46/24 brd 100.64.0.255 scope global wt0\\       valid_lft forever',
    '',
].join('\n');
const parsed = parseIpAddr(ipAddr);
eq([...parsed.keys()], ['wlp0s20f3', 'wt0'], 'parseIpAddr: ignored prefixes dropped');
eq(parsed.get('wlp0s20f3'), [
    {ip: '172.31.0.11', cidr: '172.31.0.11/24', isV6: false},
    {ip: '2001:db8::5', cidr: '2001:db8::5/64', isV6: true},
], 'parseIpAddr: rows grouped per interface');
eq(parseIpAddr('').size, 0, 'parseIpAddr: empty input');

// --- route / tunnel parsers -------------------------------------------------

eq(routeDevice('[{"dst":"1.1.1.1","gateway":"172.31.0.1","dev":"wlp0s20f3"}]'), 'wlp0s20f3', 'routeDevice: ok');
eq(routeDevice('[{"dst":"1.1.1.1"}]'), null, 'routeDevice: no dev');
eq(routeDevice('[]'), null, 'routeDevice: empty array');
eq(routeDevice('RTNETLINK answers: Network is unreachable'), null, 'routeDevice: not JSON');
eq(routeDevice(null), null, 'routeDevice: null');
eq(routeDevice(''), null, 'routeDevice: empty string');

const links = JSON.stringify([
    {ifname: 'lo', linkinfo: undefined},
    {ifname: 'wlp0s20f3'},
    {ifname: 'wg0', linkinfo: {info_kind: 'wireguard'}},
    {ifname: 'tun0', linkinfo: {info_kind: 'tun'}},
    {ifname: 'xfrm0', linkinfo: {info_kind: 'xfrm'}},
    {ifname: 'docker0', linkinfo: {info_kind: 'bridge'}},
    {ifname: 'veth1', linkinfo: {info_kind: 'veth', info_slave_kind: 'bridge'}},
]);
eq([...tunnelInterfaces(links)], ['wg0', 'tun0', 'xfrm0'], 'tunnelInterfaces: kinds');
eq(tunnelInterfaces('not json').size, 0, 'tunnelInterfaces: not JSON');
eq(tunnelInterfaces('{"a":1}').size, 0, 'tunnelInterfaces: not an array');
eq(tunnelInterfaces(null).size, 0, 'tunnelInterfaces: null');

// --- countryCode ------------------------------------------------------------

eq(countryCode('Hong Kong'), 'HK', 'countryCode: Hong Kong (short)');
eq(countryCode('Hong Kong SAR China'), 'HK', 'countryCode: Hong Kong (long)');
eq(countryCode('Germany'), 'DE', 'countryCode: Germany');
eq(countryCode('Atlantis'), null, 'countryCode: unknown');
eq(countryCode(''), null, 'countryCode: empty');

// --- latLonToTile / describeResolvers --------------------------------------

// Greenwich observatory at zoom 10
eq(latLonToTile(51.4769, 0, 10), {x: 512, y: 340}, 'latLonToTile: Greenwich z10');

eq(describeResolvers([]), 'DNS: no resolvers reported', 'describeResolvers: empty');
eq(describeResolvers([{mullvad_dns: true}, {mullvad_dns: true}]), 'DNS: 2 resolvers, all Mullvad', 'describeResolvers: all Mullvad');
eq(describeResolvers([{organization: 'Quad9', country: 'Switzerland'}, {organization: 'Quad9', country: 'Switzerland'}]),
    'DNS: Quad9 (Switzerland)', 'describeResolvers: deduplicated others');

if (failures.length > 0) {
    for (const failure of failures)
        printerr(`FAIL ${failure}`);
    printerr(`common: ${failures.length} of ${checks} check(s) failed`);
    System.exit(1);
}

print(`common: ${checks} checks passed`);
