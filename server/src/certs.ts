import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import forge from 'node-forge';
import { CERT_DIR } from './config.js';
import { logger } from './logger.js';

/**
 * Local HTTPS support.
 *
 * Browsers only allow microphone/camera access (voice messages, calls) and
 * service workers (PWA install) on "secure contexts". A plain http://192.168.x.x
 * address is NOT a secure context, so LOCAL HUB creates its own private
 * Certificate Authority on first start and issues a server certificate for
 * every LAN IP of the host. Partners can either click through the browser
 * warning once, or install the CA certificate (downloadable from the login
 * page) to make the connection fully trusted. Nothing leaves the LAN.
 */

const CA_KEY = path.join(CERT_DIR, 'localhub-ca.key');
const CA_CERT = path.join(CERT_DIR, 'localhub-ca.crt');
const SRV_KEY = path.join(CERT_DIR, 'server.key');
const SRV_CERT = path.join(CERT_DIR, 'server.crt');
const SRV_META = path.join(CERT_DIR, 'server.json');

export const CA_CERT_PATH = CA_CERT;

function rsaKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { privateKey, publicKey };
}

function serial() {
  return '01' + crypto.randomBytes(15).toString('hex');
}

function createCA() {
  const { privateKey, publicKey } = rsaKeyPair();
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicKey);
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000);
  const attrs = [
    { name: 'commonName', value: `LOCAL HUB Private CA (${os.hostname()})` },
    { name: 'organizationName', value: 'LOCAL HUB' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  const key = forge.pki.privateKeyFromPem(privateKey);
  cert.sign(key, forge.md.sha256.create());
  fs.writeFileSync(CA_KEY, privateKey, { mode: 0o600 });
  fs.writeFileSync(CA_CERT, forge.pki.certificateToPem(cert));
  logger.info('Created LOCAL HUB private certificate authority');
}

function issueServerCert(ips: string[]) {
  const caCert = forge.pki.certificateFromPem(fs.readFileSync(CA_CERT, 'utf8'));
  const caKey = forge.pki.privateKeyFromPem(fs.readFileSync(CA_KEY, 'utf8'));
  const { privateKey, publicKey } = rsaKeyPair();
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicKey);
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 825 * 24 * 3600 * 1000);
  cert.setSubject([
    { name: 'commonName', value: ips[0] || 'localhost' },
    { name: 'organizationName', value: 'LOCAL HUB' },
  ]);
  cert.setIssuer(caCert.subject.attributes);
  const host = os.hostname();
  const altNames: Array<{ type: number; value?: string; ip?: string }> = [
    { type: 2, value: 'localhost' },
    { type: 2, value: host },
    { type: 2, value: `${host}.local` },
    { type: 7, ip: '127.0.0.1' },
    ...ips.map((ip) => ({ type: 7, ip })),
  ];
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames },
    { name: 'subjectKeyIdentifier' },
    {
      name: 'authorityKeyIdentifier',
      keyIdentifier: caCert.generateSubjectKeyIdentifier().getBytes(),
    },
  ]);
  cert.sign(caKey, forge.md.sha256.create());
  fs.writeFileSync(SRV_KEY, privateKey, { mode: 0o600 });
  fs.writeFileSync(SRV_CERT, forge.pki.certificateToPem(cert));
  fs.writeFileSync(
    SRV_META,
    JSON.stringify({ ips: [...ips].sort(), host, notAfter: cert.validity.notAfter }, null, 2),
  );
  logger.info(`Issued HTTPS certificate for: localhost, ${host}, ${ips.join(', ')}`);
}

/** Ensures a CA + server certificate covering all current LAN IPs exist. */
export function ensureCertificates(ips: string[]): { key: Buffer; cert: Buffer; ca: Buffer } {
  fs.mkdirSync(CERT_DIR, { recursive: true });
  if (!fs.existsSync(CA_KEY) || !fs.existsSync(CA_CERT)) createCA();

  let reissue = !fs.existsSync(SRV_KEY) || !fs.existsSync(SRV_CERT) || !fs.existsSync(SRV_META);
  if (!reissue) {
    try {
      const meta = JSON.parse(fs.readFileSync(SRV_META, 'utf8'));
      const known = new Set<string>(meta.ips || []);
      const missing = ips.some((ip) => !known.has(ip));
      const expiring = new Date(meta.notAfter).getTime() - Date.now() < 30 * 24 * 3600 * 1000;
      reissue = missing || expiring || meta.host !== os.hostname();
    } catch {
      reissue = true;
    }
  }
  if (reissue) {
    // keep previously known IPs too, so a laptop moving between networks keeps working
    let previous: string[] = [];
    try {
      previous = JSON.parse(fs.readFileSync(SRV_META, 'utf8')).ips || [];
    } catch {
      /* none */
    }
    issueServerCert([...new Set([...ips, ...previous])].slice(0, 30));
  }
  return {
    key: fs.readFileSync(SRV_KEY),
    cert: fs.readFileSync(SRV_CERT),
    ca: fs.readFileSync(CA_CERT),
  };
}

