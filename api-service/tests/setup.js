import { vi, beforeEach } from 'vitest';

// Mock system environment
process.env.NODE_ENV = 'test';
process.env.LOG_FORMAT = 'json';
process.env.JWT_SECRET = 'test-secret-key-for-unit-testing-only';
process.env.DB_PATH = ':memory:';
process.env.ALLOWED_ORIGINS = '*';
process.env.VITEST = 'true';

// vi.mock('../src/services/shell', ...) below does NOT reach code that goes
// through resolveExecutor()/executors/local.js: those call shell-core.js's
// runCommand() directly via require(), which Vitest's mock interception does
// not cover for plain CJS require() chains (same limitation the ssh executor
// already documents in services/executors/ssh.js). Without this flag, any
// route exercised through supertest (not just unit-level service calls) ends
// up invoking real `sudo`/wg-*.sh scripts on the machine running the tests.
// shell-core.js checks this flag as the actual last line of defense.
global.TEST_MOCK_SHELL = true;

// --- GLOBAL MOCKS ---

// 1. AXIOS (Static string mock)
vi.mock('axios', () => ({
  default: {
    get: vi.fn().mockResolvedValue({
      data: { status: 'ok', enabled: true, version: '3.0', initialized: true },
      status: 200,
    }),
    post: vi.fn().mockResolvedValue({ data: { success: true }, status: 200 }),
    put: vi.fn().mockResolvedValue({ data: { success: true }, status: 200 }),
    delete: vi.fn().mockResolvedValue({ data: { success: true }, status: 200 }),
    patch: vi.fn().mockResolvedValue({ data: { success: true }, status: 200 }),
  },
  get: vi.fn().mockResolvedValue({
    data: { status: 'ok', enabled: true, version: '3.0', initialized: true },
    status: 200,
  }),
  post: vi.fn().mockResolvedValue({ data: { success: true }, status: 200 }),
  put: vi.fn().mockResolvedValue({ data: { success: true }, status: 200 }),
  all: Promise.all.bind(Promise),
  spread: (fn) => (res) => fn(...res),
}));

// 2. SHELL (Static path relative to tests/setup.js)
vi.mock('../src/services/shell', () => ({
  runCommand: vi.fn().mockResolvedValue({ success: true, stdout: 'OK', stderr: '' }),
  runSystemCommand: vi.fn().mockResolvedValue({ success: true, stdout: 'OK', stderr: '' }),
  writeFileAsRoot: vi.fn().mockResolvedValue({ success: true }),
  appendFileAsRoot: vi.fn().mockResolvedValue({ success: true }),
  unlinkAsRoot: vi.fn().mockResolvedValue({ success: true }),
  readFileAsRoot: vi.fn().mockResolvedValue({ success: true, content: 'MOCK_FILE_CONTENT' }),
  readdirAsRoot: vi.fn().mockResolvedValue({ success: true, stdout: 'file1.tar.gz' }),
  readFile: vi.fn().mockResolvedValue({ success: true, content: 'config_data=1' }),
  writeFile: vi.fn().mockResolvedValue({ success: true }),
  listDir: vi.fn().mockResolvedValue({ success: true, files: ['a', 'b'] }),
  unlink: vi.fn().mockResolvedValue({ success: true }),
  SUDO: 'sudo',
  SUDO_ARGS: ['-n'],
}));

vi.mock('../src/services/audit', () => ({
  auditLog: vi.fn().mockResolvedValue(true),
  gcAuditLogs: vi.fn().mockResolvedValue({ success: true, count: 0 }),
}));

vi.mock('../src/services/system', () => ({
  getWireGuardStats: vi.fn().mockResolvedValue([]),
  getSystemStats: vi.fn().mockResolvedValue({ cpu: 10, mem: 20, disk: 30 }),
  getTelemetry: vi.fn().mockResolvedValue({ rx: 100, tx: 200 }),
  getInterfaces: vi
    .fn()
    .mockResolvedValue([{ name: 'wg0', type: 'WireGuard', status: 'up', mtu: '1420' }]),
  formatBytes: vi.fn((b) => `${b} B`),
  getInterfacePath: vi.fn((i) => `/sys/class/net/${i}`),
  getClientDir: vi.fn(
    (container, name) =>
      `${process.env.WG_CLIENTS_DIR || '/etc/wireguard/clients'}/${container}/${name}`
  ),
  parseWireGuardDump: vi.fn(() => []),
  checkScripts: vi.fn().mockResolvedValue(true),
  isValidName: vi.fn(() => true),
  isValidExpiry: vi.fn(() => true),
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event, cb) => {
      if (event === 'close' || event === 'exit') cb(0);
    }),
    kill: vi.fn(),
    stdin: { write: vi.fn(), end: vi.fn() },
  })),
  exec: vi.fn((cmd, cb) => cb(null, { stdout: 'OK' })),
  execSync: vi.fn(() => Buffer.from('OK')),
}));

beforeEach(() => {
  vi.clearAllMocks();
});
