import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as createSocket } from 'socket.io-client';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3199;
const HTTPS_PORT = 3599;

// Real minimal valid binary payloads for content-sniffing verification
// 1x1 PNG
const SAMPLE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
// Minimal valid PDF
const SAMPLE_PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
// Minimal valid WAV (16-bit PCM silence)
function makeWavBuffer(seconds = 1) {
  const sampleRate = 8000;
  const dataSize = sampleRate * 2 * seconds;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}
// Minimal valid MP4 header (ftyp isom + mdat)
const SAMPLE_MP4 = Buffer.concat([
  Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
    0x00, 0x00, 0x02, 0x00, 0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
  ]),
  Buffer.from([0x00, 0x00, 0x00, 0x10, 0x6d, 0x64, 0x61, 0x74]),
  Buffer.alloc(8192, 0x42),
]);
// Fake malicious Windows PE executable disguised as photo.jpg
const FAKE_EXE = Buffer.concat([Buffer.from('MZ\x90\x00\x03\x00\x00\x00'), Buffer.alloc(128, 0)]);

class TestClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookie = '';
    this.token = '';
    this.user = null;
    this.socket = null;
  }

  async req(p, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (this.cookie) headers['Cookie'] = this.cookie;
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(`${this.baseUrl}${p}`, {
      method: opts.method || (opts.json !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const m = /lh_session=([^;]+)/.exec(setCookie);
      if (m) this.cookie = `lh_session=${m[1]}`;
    }
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : await res.arrayBuffer();
    return { status: res.status, headers: res.headers, data };
  }

  connectSocket() {
    return new Promise((resolve, reject) => {
      const s = createSocket(this.baseUrl, {
        extraHeaders: { Cookie: this.cookie },
        transports: ['websocket'],
      });
      this.socket = s;
      const timer = setTimeout(() => reject(new Error('Socket connect timeout')), 8000);
      s.once('connect', () => {
        clearTimeout(timer);
        resolve(s);
      });
      s.once('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}

function startServer() {
  const proc = spawn(process.execPath, [path.join(root, 'server', 'dist', 'index.js')], {
    cwd: root,
    env: {
      ...process.env,
      LOCALHUB_PORT: String(PORT),
      LOCALHUB_HTTPS_PORT: String(HTTPS_PORT),
      LOCALHUB_HTTPS: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  proc.stdout.on('data', (d) => (logs += d.toString()));
  proc.stderr.on('data', (d) => (logs += d.toString()));
  return { proc, getLogs: () => logs };
}

async function waitForHealth(baseUrl, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/system/health`);
      if (res.ok) return;
    } catch {
      /* waiting */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Server did not become healthy in time');
}

async function stopServer(proc) {
  if (!proc || proc.killed) return;
  proc.kill('SIGTERM');
  await new Promise((r) => {
    proc.once('exit', r);
    setTimeout(r, 3000);
  });
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { rejectUnauthorized: false }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      })
      .on('error', reject);
  });
}

function onceEvent(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout waiting for socket event "${event}"`)), timeoutMs);
    socket.once(event, (data) => {
      clearTimeout(t);
      resolve(data);
    });
  });
}

async function run() {
  console.log('--- LOCAL HUB Full Acceptance & Security E2E Suite ---');

  // Ensure completely clean DB & storage for deterministic test run
  for (const dir of ['storage', 'backups']) {
    await fsp.rm(path.join(root, dir), { recursive: true, force: true }).catch(() => {});
  }
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    await fsp.rm(path.join(root, 'database', `localhub.db${suffix}`), { force: true }).catch(() => {});
  }
  await fsp.rm(path.join(root, 'config', 'setup-token.txt'), { force: true }).catch(() => {});

  // Apply Prisma migration on fresh DB
  await new Promise((resolve, reject) => {
    const p = spawn(process.platform === 'win32' ? 'cmd' : 'sh', [
      process.platform === 'win32' ? '/c' : '-c',
      'npm run db:migrate',
    ], { cwd: root, stdio: 'pipe' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('db:migrate failed'))));
  });

  let srv = startServer();
  const localUrl = `http://127.0.0.1:${PORT}`;
  try {
    await waitForHealth(localUrl);
    console.log('✓ [1] Server started on 0.0.0.0:' + PORT + ' and HTTPS :' + HTTPS_PORT);

    // 1. System info, LAN IP detection, HTTPS listener & CA cert
    const infoRes = await fetch(`${localUrl}/api/system/info`);
    const info = await infoRes.json();
    assert.equal(info.needsSetup, true);
    assert.equal(info.httpsEnabled, true);
    assert.equal(info.hasCaCert, true);
    const lanIp = info.lanAddresses[0]?.address || '127.0.0.1';
    const lanUrl = `http://${lanIp}:${PORT}`;
    const lanHealth = await fetch(`${lanUrl}/api/system/health`);
    assert.equal(lanHealth.status, 200, 'Server must be reachable via detected LAN IP');
    const httpsRes = await httpsGet(`https://${lanIp}:${HTTPS_PORT}/api/system/health`);
    assert.equal(httpsRes.status, 200, 'HTTPS server must respond on LAN IP');
    const caRes = await fetch(`${lanUrl}/api/system/ca.crt`);
    assert.equal(caRes.status, 200);
    assert.ok((await caRes.text()).includes('BEGIN CERTIFICATE'));
    console.log(`✓ [2] LAN IP (${lanIp}) HTTP + HTTPS + Private CA certificate verified`);

    // 2. First-run setup security + Owner creation
    const setupCode = fs.readFileSync(path.join(root, 'config', 'setup-token.txt'), 'utf8').trim();
    const owner = new TestClient(lanUrl);
    const badSetup = await owner.req('/api/auth/setup', {
      json: { setupCode: 'WRONG-CODE', username: 'owner', displayName: 'Owner', password: 'Password123' },
    });
    assert.equal(badSetup.status, 403, 'Wrong setup code must be rejected');

    const goodSetup = await owner.req('/api/auth/setup', {
      json: {
        setupCode,
        workspaceName: 'Studio Five',
        username: 'owner',
        displayName: 'Alex Owner',
        password: 'Password123',
      },
    });
    assert.equal(goodSetup.status, 201);
    owner.user = goodSetup.data.user;
    assert.equal(owner.user.role, 'OWNER');

    // Unauthenticated API access must fail
    const anon = new TestClient(lanUrl);
    assert.equal((await anon.req('/api/conversations')).status, 401);
    assert.equal((await anon.req('/api/files')).status, 401);
    assert.equal((await anon.req('/api/admin/overview')).status, 401);
    console.log('✓ [3] Owner setup + unauthenticated access blocking verified');

    // 3. Create 4 invitations & register 4 partners (total = 5 team members)
    const partners = [];
    const inviteCodes = [];
    for (let i = 1; i <= 4; i++) {
      const invRes = await owner.req('/api/admin/invitations', {
        json: { role: 'PARTNER', note: `Partner ${i}`, expiresInHours: 48 },
      });
      assert.equal(invRes.status, 201);
      const code = invRes.data.invitation.code;
      inviteCodes.push(code);

      const p = new TestClient(lanUrl);
      const reg = await p.req('/api/auth/register', {
        json: {
          inviteCode: code,
          username: `partner${i}`,
          displayName: `Partner ${i}`,
          password: `PartnerPass${i}9`,
        },
      });
      assert.equal(reg.status, 201);
      p.user = reg.data.user;
      partners.push(p);
    }

    // Reusing an invite code must fail
    const reuse = await anon.req('/api/auth/register', {
      json: { inviteCode: inviteCodes[0], username: 'intruder', displayName: 'Intruder', password: 'Password123' },
    });
    assert.equal(reuse.status, 403, 'Used invite must be rejected');

    // 6th user when maxUsers=5 must fail even with a fresh invite
    const extraInv = await owner.req('/api/admin/invitations', { json: { role: 'PARTNER' } });
    const sixth = await anon.req('/api/auth/register', {
      json: {
        inviteCode: extraInv.data.invitation.code,
        username: 'sixthuser',
        displayName: 'Sixth',
        password: 'Password123',
      },
    });
    assert.equal(sixth.status, 403, '6th user must be blocked by 5-member limit');

    // Partner cannot access Admin endpoints (RBAC)
    assert.equal((await partners[0].req('/api/admin/overview')).status, 403, 'Partner must not access Admin API');
    console.log('✓ [4] 5 accounts (1 Owner + 4 Partners), single-use invites, 5-member cap & RBAC verified');

    // 4. Connect all 5 users via Socket.IO over LAN IP & verify presence
    const allClients = [owner, ...partners];
    await Promise.all(allClients.map((c) => c.connectSocket()));
    const userList = (await owner.req('/api/users')).data.users;
    assert.equal(userList.length, 5);
    assert.equal(userList.filter((u) => u.online).length, 5, 'All 5 users must show online');
    console.log('✓ [5] 5 simultaneous LAN Socket.IO connections & live online presence verified');

    // 5. Real-time messaging (Team chat, DM, Group chat, reply, edit, react, pin, forward, search, delete)
    const convs = (await owner.req('/api/conversations')).data.conversations;
    const team = convs.find((c) => c.type === 'TEAM');
    assert.ok(team, 'Team channel must exist');
    assert.equal(team.members.length, 5);

    const teamMsgPromise = onceEvent(partners[3].socket, 'message:new');
    const sentTeam = await owner.req(`/api/conversations/${team.id}/messages`, {
      json: { content: 'Hello team on LOCAL HUB!' },
    });
    assert.equal(sentTeam.status, 201);
    const recvTeam = await teamMsgPromise;
    assert.equal(recvTeam.content, 'Hello team on LOCAL HUB!');

    // Direct message between Partner 1 and Partner 2
    const dmRes = await partners[0].req('/api/conversations/direct', { json: { userId: partners[1].user.id } });
    assert.equal(dmRes.status, 200);
    const dmId = dmRes.data.conversation.id;

    // Typing indicator test
    const typingPromise = onceEvent(partners[1].socket, 'typing:update');
    partners[0].socket.emit('typing:start', { conversationId: dmId });
    const typingEv = await typingPromise;
    assert.equal(typingEv.typing, true);
    assert.equal(typingEv.userId, partners[0].user.id);

    const dmMsgPromise = onceEvent(partners[1].socket, 'message:new');
    const dmSent = await partners[0].req(`/api/conversations/${dmId}/messages`, {
      json: { content: 'Private note between P1 and P2' },
    });
    assert.equal(dmSent.status, 201);
    await dmMsgPromise;

    // Partner 3 must NOT be able to read Partner 1 & 2's private DM!
    const spyDm = await partners[2].req(`/api/conversations/${dmId}/messages`);
    assert.equal(spyDm.status, 404, 'Unauthorized member must not read private DM');

    // Group conversation + reply + edit + reaction + pin + forward + search + read receipt
    const grpRes = await owner.req('/api/conversations/group', {
      json: {
        name: 'Launch Squad',
        description: 'Shipping v1',
        memberIds: [partners[0].user.id, partners[1].user.id],
      },
    });
    assert.equal(grpRes.status, 201);
    const grpId = grpRes.data.conversation.id;

    const m1 = (await owner.req(`/api/conversations/${grpId}/messages`, { json: { content: 'Alpha milestone' } })).data.message;
    const m2 = (
      await partners[0].req(`/api/conversations/${grpId}/messages`, {
        json: { content: 'Replied to alpha', replyToId: m1.id },
      })
    ).data.message;
    assert.equal(m2.replyTo.id, m1.id);

    const edited = await partners[0].req(`/api/messages/${m2.id}`, { method: 'PATCH', json: { content: 'Replied & edited' } });
    assert.equal(edited.status, 200);
    assert.ok(edited.data.message.editedAt);

    const reacted = await owner.req(`/api/messages/${m2.id}/reactions`, { json: { emoji: '🔥' } });
    assert.equal(reacted.data.message.reactions[0].emoji, '🔥');

    const pinned = await owner.req(`/api/messages/${m1.id}/pin`, { json: { pinned: true } });
    assert.ok(pinned.data.message.pinnedAt);

    const forwarded = await owner.req(`/api/messages/${m1.id}/forward`, { json: { conversationIds: [team.id] } });
    assert.equal(forwarded.data.messages[0].forwarded, true);

    const searchRes = await owner.req('/api/messages/search?q=milestone');
    assert.ok(searchRes.data.messages.length >= 2);

    const readEvent = onceEvent(owner.socket, 'conversation:read');
    partners[0].socket.emit('conversation:read', { conversationId: grpId });
    const rEv = await readEvent;
    assert.equal(rEv.userId, partners[0].user.id);
    console.log('✓ [6] DMs, Groups, Team chat, replies, edits, reactions, pins, forwarding, typing, read receipts & search verified');

    // 6. File Uploads, Content Verification, Chunked Video Upload, Range Streaming, Voice Messages & Private File Security
    // 6a. Malicious exe disguised as photo.jpg MUST be rejected!
    const badFile = await owner.req('/api/files/upload', {
      method: 'POST',
      headers: { 'x-file-name': 'photo.jpg', 'Content-Type': 'image/jpeg' },
      body: FAKE_EXE,
    });
    assert.equal(badFile.status, 400, 'Disguised executable must be rejected by magic-byte inspection');

    // 6b. Real PNG image upload + thumbnail
    const imgUp = await partners[0].req('/api/files/upload', {
      method: 'POST',
      headers: { 'x-file-name': 'secret-design.png', 'x-file-scope': 'CHAT' },
      body: SAMPLE_PNG,
    });
    assert.equal(imgUp.status, 201);
    const secretFile = imgUp.data.file;
    assert.equal(secretFile.category, 'IMAGE');
    assert.equal(secretFile.mime, 'image/png');
    assert.ok(secretFile.thumbUrl, 'PNG should generate a thumbnail');

    // Share secretFile in DM between Partner 1 & Partner 2
    const dmFileMsg = await partners[0].req(`/api/conversations/${dmId}/messages`, {
      json: { content: 'Confidential wireframe', fileIds: [secretFile.id] },
    });
    assert.equal(dmFileMsg.status, 201);

    // Partner 2 CAN download it; Partner 3 MUST get 404!
    assert.equal((await partners[1].req(secretFile.url)).status, 200, 'DM recipient must access file');
    assert.equal((await partners[2].req(secretFile.url)).status, 404, 'Non-member must NOT access private DM file');
    assert.equal((await partners[2].req(secretFile.thumbUrl)).status, 404, 'Non-member must NOT access private DM thumbnail');

    // 6c. PDF Document upload to Shared Workspace
    const pdfUp = await owner.req('/api/files/upload', {
      method: 'POST',
      headers: { 'x-file-name': 'Q4-Roadmap.pdf', 'x-file-scope': 'WORKSPACE', 'x-file-folder': 'Planning' },
      body: SAMPLE_PDF,
    });
    assert.equal(pdfUp.status, 201);
    assert.equal(pdfUp.data.file.mime, 'application/pdf');
    await owner.req(`/api/files/${pdfUp.data.file.id}`, { method: 'PATCH', json: { pinned: true } });

    // 6d. Voice message upload (WAV + duration + waveform)
    const wavUp = await partners[1].req('/api/files/upload', {
      method: 'POST',
      headers: {
        'x-file-name': 'voice-note.wav',
        'x-audio-hint': '1',
        'x-media-duration': '1.0',
        'x-audio-waveform': JSON.stringify([0.2, 0.5, 0.8, 0.4, 0.9, 0.3, 0.6, 0.2]),
      },
      body: makeWavBuffer(1),
    });
    assert.equal(wavUp.status, 201);
    assert.equal(wavUp.data.file.category, 'AUDIO');
    const voiceMsg = await partners[1].req(`/api/conversations/${team.id}/messages`, {
      json: { type: 'VOICE', fileIds: [wavUp.data.file.id] },
    });
    assert.equal(voiceMsg.status, 201);
    assert.equal(voiceMsg.data.message.type, 'VOICE');

    // 6e. Chunked Resumable Upload for Video (MP4) + HTTP Range 206 Streaming
    const initUp = await owner.req('/api/files/uploads/init', {
      json: { name: 'demo-clip.mp4', size: SAMPLE_MP4.length, purpose: 'WORKSPACE' },
    });
    assert.equal(initUp.status, 201);
    const half = Math.floor(SAMPLE_MP4.length / 2);
    const c1 = await owner.req(`/api/files/uploads/${initUp.data.uploadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/octet-stream', 'x-upload-offset': '0' },
      body: SAMPLE_MP4.subarray(0, half),
    });
    assert.equal(c1.status, 200);
    const c2 = await owner.req(`/api/files/uploads/${initUp.data.uploadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/octet-stream', 'x-upload-offset': String(half) },
      body: SAMPLE_MP4.subarray(half),
    });
    assert.equal(c2.status, 200);
    const comp = await owner.req(`/api/files/uploads/${initUp.data.uploadId}/complete`, { method: 'POST' });
    assert.equal(comp.status, 201);
    const videoFile = comp.data.file;
    assert.equal(videoFile.category, 'VIDEO');

    const rangeRes = await owner.req(videoFile.url, { headers: { Range: 'bytes=0-1023' } });
    assert.equal(rangeRes.status, 206, 'Video streaming must support HTTP 206 Range requests');
    assert.equal(rangeRes.data.byteLength, 1024);

    // Media gallery includes video
    const gallery = await partners[3].req('/api/files/gallery');
    assert.ok(gallery.data.files.some((f) => f.id === videoFile.id));
    console.log('✓ [7] File verification, thumbnails, voice notes, chunked MP4 + Range 206 & private file isolation verified');

    // 7. WebRTC 5-member group call signaling over LAN
    const incomingPromises = partners.map((p) => onceEvent(p.socket, 'call:incoming'));
    const started = await new Promise((r) => owner.socket.emit('call:start', { conversationId: team.id, video: true }, r));
    assert.equal(started.ok, true);
    const callId = started.call.id;
    const incomingList = await Promise.all(incomingPromises);
    assert.equal(incomingList.length, 4);

    for (const p of partners) {
      const joined = await new Promise((r) => p.socket.emit('call:join', { callId, audio: true, video: false }, r));
      assert.equal(joined.ok, true);
    }

    // Relay SDP signal from Partner 1 -> Owner
    const sigPromise = onceEvent(owner.socket, 'call:signal');
    partners[0].socket.emit('call:signal', {
      callId,
      toUserId: owner.user.id,
      payload: { type: 'sdp', description: { type: 'offer', sdp: 'v=0...' } },
    });
    const sig = await sigPromise;
    assert.equal(sig.fromUserId, partners[0].user.id);

    // All leave -> CALL message persisted
    const callMsgPromise = onceEvent(owner.socket, 'message:new');
    for (const c of allClients) c.socket.emit('call:leave', { callId });
    const callLogMsg = await callMsgPromise;
    assert.equal(callLogMsg.type, 'CALL');
    console.log('✓ [8] 5-member LAN WebRTC signaling, SDP relay & call history message verified');

    // 8. Shared Workspace (Announcements, Notes, Tasks, Todos, Links)
    assert.equal((await owner.req('/api/workspace/announcements', { json: { title: 'Kickoff', body: 'Welcome!', pinned: true } })).status, 201);
    const note = (await partners[0].req('/api/workspace/notes', { json: { title: 'Architecture', content: 'LAN only' } })).data.note;
    assert.equal((await partners[1].req(`/api/workspace/notes/${note.id}`, { method: 'PATCH', json: { content: 'Updated by P2' } })).status, 200);
    const task = (await owner.req('/api/workspace/tasks', { json: { title: 'Prepare release', priority: 'HIGH', assigneeId: partners[0].user.id } })).data.task;
    assert.equal((await partners[0].req(`/api/workspace/tasks/${task.id}`, { method: 'PATCH', json: { status: 'DONE' } })).status, 200);
    const todoList = (await owner.req('/api/workspace/todos', { json: { title: 'Checklist', shared: true } })).data.list;
    assert.equal((await partners[2].req(`/api/workspace/todos/${todoList.id}/items`, { json: { text: 'Test LAN' } })).status, 201);
    assert.equal((await owner.req('/api/workspace/links', { json: { title: 'XSS', url: 'javascript:alert(1)' } })).status, 400, 'javascript: URLs must be rejected');
    assert.equal((await owner.req('/api/workspace/links', { json: { title: 'Router', url: 'http://192.168.1.1' } })).status, 201);
    console.log('✓ [9] Shared workspace (announcements, notes, tasks, to-dos, safe links) verified');

    // 9. Admin Overview, Consistency Check, Deactivation, Logout All, Backup & Restore
    const check = (await owner.req('/api/admin/storage/consistency-check', { method: 'POST' })).data;
    assert.equal(check.healthy, true, 'DB & storage consistency check must be healthy');

    // Create full backup BEFORE making destructive changes
    const backup = (await owner.req('/api/admin/backups', { json: { includeFiles: true, note: 'Pre-restart backup' } })).data.backup;
    assert.ok(backup.name);
    assert.ok(backup.fileCount >= 3);

    // Test user deactivation kicks session & blocks login
    await owner.req(`/api/admin/users/${partners[3].user.id}`, { method: 'PATCH', json: { isActive: false } });
    assert.equal((await partners[3].req('/api/auth/me')).status, 401, 'Deactivated user session must be revoked');
    await owner.req(`/api/admin/users/${partners[3].user.id}`, { method: 'PATCH', json: { isActive: true } });

    // Disconnect sockets & test SERVER RESTART persistence (Acceptance Tests #10 & #11)
    for (const c of allClients) c.disconnect();
    await stopServer(srv.proc);

    srv = startServer();
    await waitForHealth(localUrl);
    const afterRestartMsgs = (await owner.req(`/api/conversations/${team.id}/messages`)).data.messages;
    assert.ok(afterRestartMsgs.some((m) => m.content === 'Hello team on LOCAL HUB!'), 'Messages must persist across restart');
    assert.equal((await owner.req(videoFile.url)).status, 200, 'Uploaded files must remain accessible after restart');
    console.log('✓ [10] Server restart persistence for messages, sessions & uploaded files verified');

    // Test Backup Restore (Acceptance Test #14): delete task, restore backup, verify task returns!
    await owner.req(`/api/workspace/tasks/${task.id}`, { method: 'DELETE' });
    let tasksAfterDel = (await owner.req('/api/workspace/tasks')).data.tasks;
    assert.equal(tasksAfterDel.length, 0);

    const restoreRes = await owner.req(`/api/admin/backups/${encodeURIComponent(backup.name)}/restore`, { method: 'POST' });
    assert.equal(restoreRes.status, 200);

    const tasksAfterRestore = (await owner.req('/api/workspace/tasks')).data.tasks;
    assert.equal(tasksAfterRestore.length, 1, 'Deleted task must be restored from backup');
    assert.equal(tasksAfterRestore[0].title, 'Prepare release');
    console.log('✓ [11] Full database + file backup & verified restore passed!');

    // Verify audit logs & server logs work
    const audit = (await owner.req('/api/admin/audit')).data.logs;
    assert.ok(audit.length >= 5);
    const logs = (await owner.req('/api/admin/logs')).data.lines;
    assert.ok(logs.length >= 1);

    // Verify logout-all revokes current session
    assert.equal((await owner.req('/api/auth/logout-all', { method: 'POST' })).status, 200);
    assert.equal((await owner.req('/api/auth/me')).status, 401);
    console.log('✓ [12] Audit logs, server logs & logout-from-all-devices verified');

    console.log('\nALL E2E & SECURITY TESTS PASSED!');
  } catch (err) {
    console.error('\nTEST FAILED:', err);
    console.error('\n--- SERVER LOGS ---\n', srv.getLogs());
    process.exitCode = 1;
  } finally {
    await stopServer(srv.proc);
  }
}

run();

