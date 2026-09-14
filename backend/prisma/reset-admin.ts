/**
 * Break-glass admin password reset (CLI).
 *
 * The recovery path for when the only admin forgets their password and there is
 * no second admin to reset it from the app. It talks to the database directly —
 * not the HTTP API — so it adds no attack surface to the running service; the
 * authorization is "you have access to the server / database".
 *
 * On the droplet (container WORKDIR is the backend):
 *   docker compose exec backend npm run admin:reset -- --user admin --password 'NEW_PASSWORD'
 *
 * Locally (dev):
 *   npm --prefix backend run admin:reset -- --user admin --password 'NEW_PASSWORD'
 *   npm --prefix backend run admin:reset -- --list           # see accounts first
 *
 * If --password is omitted it is read from $ADMIN_RESET_PASSWORD, or prompted
 * for interactively (hidden) so it never lands in shell history.
 *
 * Flags:
 *   --user, -u <name>     account username (required unless --list/--help)
 *   --password, -p <pw>   new password (else $ADMIN_RESET_PASSWORD, else prompt)
 *   --create              create the account if it doesn't exist (as ADMIN)
 *   --make-admin          (re)grant the ADMIN role
 *   --unlock              clear any lock and re-activate the account
 *   --role <admin|user>   set the role explicitly
 *   --list                list all accounts and exit
 *   --help, -h            show this help
 */
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as readline from 'readline';

const MIN_PASSWORD = 6;

interface Args {
  username?: string;
  password?: string;
  create: boolean;
  makeAdmin: boolean;
  unlock: boolean;
  role?: 'ADMIN' | 'USER';
  list: boolean;
  help: boolean;
}

const HELP = `
Break-glass admin password reset

Usage:
  npm run admin:reset -- --user <name> --password '<new password>' [flags]
  npm run admin:reset -- --list

Flags:
  -u, --user <name>       account username (required unless --list)
  -p, --password <pw>     new password (else $ADMIN_RESET_PASSWORD, else prompt)
      --create            create the account if missing (as ADMIN)
      --make-admin        (re)grant the ADMIN role
      --unlock            clear any lock and re-activate the account
      --role <admin|user> set the role explicitly
      --list              list all accounts and exit
  -h, --help              show this help

Examples:
  # reset the existing admin's password
  npm run admin:reset -- --user admin --password 'S0me-strong-pass'

  # total lockout: recreate an admin from scratch
  npm run admin:reset -- --user admin --password 'S0me-strong-pass' --create

  # on the droplet
  docker compose exec backend npm run admin:reset -- --user admin --password 'S0me-strong-pass' --unlock
`;

function parseArgs(argv: string[]): Args {
  const a: Args = { create: false, makeAdmin: false, unlock: false, list: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    const next = () => argv[++i];
    switch (t) {
      case '-u':
      case '--user':
      case '--username': a.username = next(); break;
      case '-p':
      case '--password': a.password = next(); break;
      case '--role': {
        const r = (next() || '').toUpperCase();
        if (r === 'ADMIN' || r === 'USER') a.role = r;
        else { console.error(`Invalid --role "${r}" (use admin|user).`); process.exit(2); }
        break;
      }
      case '--create': a.create = true; break;
      case '--make-admin': a.makeAdmin = true; break;
      case '--unlock': a.unlock = true; break;
      case '--list': a.list = true; break;
      case '-h':
      case '--help': a.help = true; break;
      default:
        console.error(`Unknown argument: ${t}`);
        a.help = true;
    }
  }
  return a;
}

/** Read a line from the terminal without echoing it. */
function promptHidden(query: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('No password provided and no terminal to prompt on. Pass --password or set $ADMIN_RESET_PASSWORD.'));
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(query);
    // Mute echo of everything typed after the prompt is shown.
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function resolvePassword(a: Args): Promise<string> {
  let pw = a.password || process.env.ADMIN_RESET_PASSWORD || '';
  if (!pw) pw = await promptHidden('New password: ');
  if (!pw || !pw.trim()) throw new Error('Empty password.');
  if (pw.length < MIN_PASSWORD) throw new Error(`Password too short (minimum ${MIN_PASSWORD} characters).`);
  if (pw.length < 12) console.warn('⚠  Tip: use 12+ characters for an admin account.');
  return pw;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return; }

  const prisma = new PrismaClient();
  try {
    if (args.list) {
      const users = await prisma.user.findMany({
        orderBy: { createdAt: 'asc' },
        select: { username: true, role: true, active: true, locked: true, createdAt: true },
      });
      const admins = users.filter((u) => u.role === 'ADMIN').length;
      console.log(`\n${users.length} account(s) · ${admins} admin(s):\n`);
      for (const u of users) {
        console.log(`  ${u.username.padEnd(20)} [${u.role}]  ${u.active ? 'active' : 'INACTIVE'}${u.locked ? ' · LOCKED' : ''}`);
      }
      if (admins === 0) console.log('\n⚠  No admin accounts exist. Use --create to make one.');
      return;
    }

    if (!args.username) throw new Error('Missing --user <username>. Run with --help for usage, or --list to see accounts.');

    const password = await resolvePassword(args);
    const passwordHash = await bcrypt.hash(password, 12);

    const existing = await prisma.user.findUnique({ where: { username: args.username } });
    let created = false;
    let result;

    if (!existing) {
      if (!(args.create || args.makeAdmin)) {
        throw new Error(`No account named "${args.username}". Pass --create to create it (as admin).`);
      }
      const role: Role = args.role === 'USER' ? Role.USER : Role.ADMIN; // recovery tool creates admins by default
      result = await prisma.user.create({
        data: { username: args.username, passwordHash, role, active: true, locked: false },
        select: { id: true, username: true, role: true, active: true, locked: true },
      });
      created = true;
    } else {
      const data: { passwordHash: string; role?: Role; active?: boolean; locked?: boolean } = { passwordHash };
      if (args.role) data.role = args.role === 'ADMIN' ? Role.ADMIN : Role.USER;
      else if (args.makeAdmin) data.role = Role.ADMIN;
      if (args.unlock) { data.active = true; data.locked = false; }
      result = await prisma.user.update({
        where: { id: existing.id },
        data,
        select: { id: true, username: true, role: true, active: true, locked: true },
      });
    }

    // Record it in the immutable audit trail (best-effort — never fail the reset
    // just because the audit write did).
    try {
      await prisma.auditLog.create({
        data: {
          action: created ? 'ADMIN_CREATE_CLI' : 'PASSWORD_RESET_CLI',
          actorName: 'server-cli',
          targetType: 'USER',
          targetId: result.id,
          detail: `${created ? 'created' : 'password reset'} for "${result.username}" (role ${result.role})${args.unlock ? ', unlocked' : ''} via server CLI`,
        },
      });
    } catch (_e) { /* audit is non-critical for recovery */ }

    console.log(`\n✔ ${created ? 'Created' : 'Password reset for'} "${result.username}" — role ${result.role}, ${result.active ? 'active' : 'INACTIVE'}${result.locked ? ', LOCKED' : ', unlocked'}.`);
    console.log('  Log in with the new password, then change it from the app.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('\n✖ ' + (e && e.message ? e.message : e));
  process.exit(1);
});
