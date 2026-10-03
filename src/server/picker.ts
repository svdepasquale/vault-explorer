import { execFile } from 'node:child_process';

const SCRIPT = [
  'on run argv',
  '  tell me to activate',
  '  set promptText to "Select the vault repository (the folder that contains wiki/)"',
  '  if (count of argv) > 0 then',
  '    set chosen to choose folder with prompt promptText default location (POSIX file (item 1 of argv))',
  '  else',
  '    set chosen to choose folder with prompt promptText',
  '  end if',
  '  return POSIX path of chosen',
  'end run',
];

export const pickerSupported = process.platform === 'darwin';

/** Native macOS folder chooser. Resolves null when the user cancels. */
export function pickFolder(startIn: string | null): Promise<string | null> {
  if (!pickerSupported) return Promise.reject(new Error('The native folder picker is macOS-only; type the path instead.'));
  const args = SCRIPT.flatMap((line) => ['-e', line]);
  if (startIn) args.push(startIn);
  return new Promise((resolvePromise, reject) => {
    execFile('osascript', args, { timeout: 10 * 60_000, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) {
        if (/-128/.test(stderr) || /User canceled/i.test(stderr)) resolvePromise(null);
        else reject(new Error(stderr.trim() || err.message));
        return;
      }
      const path = stdout.trim().replace(/\/+$/, '');
      resolvePromise(path || null);
    });
  });
}
