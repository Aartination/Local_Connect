import os from 'node:os';

export interface LanAddress {
  address: string;
  iface: string;
  score: number;
  virtual: boolean;
}

const VIRTUAL_RE =
  /(virtualbox|vbox|vmware|vmnet|vethernet|hyper-v|wsl|docker|loopback|tailscale|zerotier|hamachi|vpn|tap|tun|bluetooth|npcap|utun|bridge|br-)/i;

function isPrivate(ip: string) {
  return (
    ip.startsWith('192.168.') ||
    ip.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  );
}

/**
 * Detects the host's IPv4 LAN addresses, ordered so that the most likely
 * Wi-Fi / Ethernet address comes first (virtual adapters are ranked last).
 */
export function getLanAddresses(): LanAddress[] {
  const result: LanAddress[] = [];
  const ifaces = os.networkInterfaces();
  for (const [name, list] of Object.entries(ifaces)) {
    for (const info of list || []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      if (info.address.startsWith('169.254.')) continue; // link-local / no DHCP
      const virtual = VIRTUAL_RE.test(name);
      let score = 0;
      if (isPrivate(info.address)) score += 10;
      if (/wi-?fi|wlan|wireless/i.test(name)) score += 6;
      if (/^(ethernet|eth|en)\d*$/i.test(name) || /^ethernet$/i.test(name)) score += 4;
      if (virtual) score -= 20;
      result.push({ address: info.address, iface: name, score, virtual });
    }
  }
  return result.sort((a, b) => b.score - a.score);
}

export function primaryLanAddress(): string {
  return getLanAddresses()[0]?.address ?? '127.0.0.1';
}

