import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { hashPassword } from '../infrastructure/auth/scrypt-password.js';

const MIN_LENGTH = 12;

/** Reads one line from a TTY without echoing it. */
function promptHidden(question: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, done) {
      if (!muted) process.stderr.write(chunk);
      done();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stderr.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

async function readFirstLine(): Promise<string> {
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    rl.close();
    return line;
  }
  return '';
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

let password: string;
if (process.stdin.isTTY) {
  password = await promptHidden('Hasło operatora: ');
  const again = await promptHidden('Powtórz hasło: ');
  if (password !== again) fail('Hasła się różnią.');
} else {
  password = await readFirstLine();
}
if (password.length < MIN_LENGTH) fail(`Hasło musi mieć co najmniej ${MIN_LENGTH} znaków.`);

process.stdout.write(`${await hashPassword(password)}\n`);
