/**
 * Prints the scrypt hash of a password for the user file (WBS 1.2.2):
 *   npm run hash-password -w @neuromep/api
 * The password is read from standard input, so it does not end up in the shell history.
 */
import { createInterface } from 'node:readline/promises';
import { hashPassword } from './passwords.js';

const rl = createInterface({ input: process.stdin, output: process.stderr });
const password = await rl.question('Password: ');
rl.close();
if (password.length < 12) {
  console.error('Use at least 12 characters.');
  process.exit(1);
}
console.log(await hashPassword(password));
