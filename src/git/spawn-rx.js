//import * as _ from 'lodash';
import * as path from 'path';
import * as net from 'net';
import { Observable, Subscription, AsyncSubject } from 'rxjs';
import * as sfs from 'fs';

const omit = require('lodash.omit');

const spawnOg = require('child_process').spawn;
const isWindows = process.platform === 'win32';

// const d = require('debug-electron')('surf:promise-array');

/**
 * stat a file but don't throw if it doesn't exist
 *
 * @param  {string} file The path to a file
 * @return {Stats}       The stats structure
 *
 * @private
 */
function statSyncNoException(file) {
  try {
    return sfs.statSync(file);
  } catch (e) {
    return null;
  }
}

/**
 * Search PATH to see if a file exists in any of the path folders.
 *
 * @param  {string} exe The file to search for
 * @return {string}     A fully qualified path, or the original path if nothing
 *                      is found
 *
 * @private
 */
function runDownPath(exe) {
  // NB: Windows won't search PATH looking for executables in spawn like
  // Posix does

  // Files with any directory path don't get this applied
  if (exe.match(/[\\\/]/)) {
    // d('Path has slash in directory, bailing');
    return exe;
  }

  let target = path.join('.', exe);
  if (statSyncNoException(target)) {
    // d(`Found executable in currect directory: ${target}`);
    return target;
  }

  let haystack = process.env.PATH.split(isWindows ? ';' : ':');
  for (let p of haystack) {
    let needle = path.join(p, exe);
    if (statSyncNoException(needle)) return needle;
  }

  // d('Failed to find executable anywhere in path');
  return exe;
}

/**
 * Finds the actual executable and parameters to run on Windows. This method
 * mimics the POSIX behavior of being able to run scripts as executables by
 * replacing the passed-in executable with the script runner, for PowerShell,
 * CMD, and node scripts.
 *
 * This method also does the work of running down PATH, which spawn on Windows
 * also doesn't do, unlike on POSIX.
 *
 * @param  {string} exe           The executable to run
 * @param  {Array<string>} args   The arguments to run
 *
 * @return {Object}               The cmd and args to run
 * @property {string} cmd         The command to pass to spawn
 * @property {Array<string>} args The arguments to pass to spawn
 */
export function findActualExecutable(exe, args) {
  // POSIX can just execute scripts directly, no need for silly goosery
  if (process.platform !== 'win32') return { cmd: runDownPath(exe), args: args };

  if (!sfs.existsSync(exe)) {
    // NB: When you write something like `surf-client ... -- surf-build` on Windows,
    // a shell would normally convert that to surf-build.cmd, but since it's passed
    // in as an argument, it doesn't happen
    const possibleExts = ['.exe', '.bat', '.cmd', '.ps1'];
    for (let ext of possibleExts) {
      let possibleFullPath = runDownPath(`${exe}${ext}`);

      if (sfs.existsSync(possibleFullPath)) {
        return findActualExecutable(possibleFullPath, args);
      }
    }
  }

  if (exe.match(/\.ps1$/i)) {
    let cmd = path.join(process.env.SYSTEMROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'PowerShell.exe');
    let psargs = ['-ExecutionPolicy', 'Unrestricted', '-NoLogo', '-NonInteractive', '-File', exe];

    return { cmd: cmd, args: psargs.concat(args) };
  }

  if (exe.match(/\.(bat|cmd)$/i)) {
    let cmd = path.join(process.env.SYSTEMROOT, 'System32', 'cmd.exe');
    let cmdArgs = ['/C', `${exe} ${args.join(' ')}`];

    return { cmd: cmd, args: cmdArgs };
  }

  if (exe.match(/\.(js)$/i)) {
    let cmd = process.execPath;
    let nodeArgs = [exe];

    return { cmd: cmd, args: nodeArgs.concat(args) };
  }

  // Dunno lol
  return { cmd: exe, args: args };
}

/**
 * Spawns a process but detached from the current process. The process is put
 * into its own Process Group that can be killed by unsubscribing from the
 * return Observable.
 *
 * @param  {string} exe               The executable to run
 * @param  {Array<string>} params     The parameters to pass to the child
 * @param  {Object} opts              Options to pass to spawn.
 *
 * @return {Observable<string>}       Returns an Observable that when subscribed
 *                                    to, will create a detached process. The
 *                                    process output will be streamed to this
 *                                    Observable, and if unsubscribed from, the
 *                                    process will be terminated early. If the
 *                                    process terminates with a non-zero value,
 *                                    the Observable will terminate with onError.
 */
export function spawnDetached(exe, params, opts=null) {
  let { cmd, args } = findActualExecutable(exe, params);

  if (!isWindows) return spawn(cmd, args, Object.assign({}, opts || {}, {detached: true }));
  const newParams = [cmd].concat(args);

  let target = path.join(__dirname, '..', 'vendor', 'jobber', 'jobber.exe');
  let options = Object.assign({}, opts || {}, { detached: true, jobber: true });

  // d(`spawnDetached: ${target}, ${newParams}`);
  return spawn(target, newParams, options);
}


/**
 * Spawns a process attached as a child of the current process.
 *
 * @param  {string} exe               The executable to run
 * @param  {Array<string>} params     The parameters to pass to the child
 * @param  {Object} opts              Options to pass to spawn.
 *
 * @return {Observable<string>}       Returns an Observable that when subscribed
 *                                    to, will create a child process. The
 *                                    process output will be streamed to this
 *                                    Observable, and if unsubscribed from, the
 *                                    process will be terminated early. If the
 *                                    process terminates with a non-zero value,
 *                                    the Observable will terminate with onError.
 */
export function spawn(exe, params=[], opts=null) {
  opts = opts || {};
  let spawnObs = Observable.create((subj) => {
    let proc = null;

    let { cmd, args } = findActualExecutable(exe, params);
    // d(`spawning process: ${cmd} ${args.join()}, ${JSON.stringify(opts)}`);
    proc = spawnOg(cmd, args, omit(opts, 'jobber', 'split'));

    let bufHandler = (source) => (b) => {
      if (b.length < 1) return;
      let chunk = "<< String sent back was too long >>";
      try {
        chunk = b.toString();
      } catch (e) {
        chunk = `<< Lost chunk of process output for ${exe} - length was ${b.length}>>`;
      }

      subj.next({source: source, text: chunk});
    };

    let ret = new Subscription();

    if (opts.stdin) {
      if (proc.stdin) {
        ret.add(opts.stdin.subscribe(
          (x) => proc.stdin.write(x),
          subj.error,
          () => proc.stdin.end()
        ));
      } else {
        subj.error(new Error(`opts.stdio conflicts with provided spawn opts.stdin observable, 'pipe' is required`));
      }
    }

    let stderrCompleted = null;
    let stdoutCompleted = null;
    let noClose = false;

    if (proc.stdout) {
      stdoutCompleted = new AsyncSubject();
      proc.stdout.on('data', bufHandler('stdout'));
      proc.stdout.on('close', () => { stdoutCompleted.next(true); stdoutCompleted.complete(); });
    } else {
      stdoutCompleted = Observable.of(true);
    }

    if (proc.stderr) {
      stderrCompleted = new AsyncSubject();
      proc.stderr.on('data', bufHandler('stderr'));
      proc.stderr.on('close', () => { stderrCompleted.next(true); stderrCompleted.complete(); });
    } else {
      stderrCompleted = Observable.of(true);
    }

    proc.on('error', (e) => {
      noClose = true;
      subj.error(e);
    });

    proc.on('close', (code) => {
      noClose = true;
      let pipesClosed = Observable.merge(stdoutCompleted, stderrCompleted)
        .reduce((acc) => acc, true);

      if (code === 0) {
        pipesClosed.subscribe(() => subj.complete());
      } else {
        pipesClosed.subscribe(() => subj.error(new Error(`Failed with exit code: ${code}`)));
      }
    });

    ret.add(new Subscription(() => {
      if (noClose) return;

      // d(`Killing process: ${cmd} ${args.join()}`);
      if (opts.jobber) {
        // NB: Connecting to Jobber's named pipe will kill it
        net.connect(`\\\\.\\pipe\\jobber-${proc.pid}`);
        setTimeout(() => proc.kill(), 5*1000);
      } else {
        proc.kill();
      }
    }));

    return ret;
  });

  return opts.split ? spawnObs : spawnObs.pluck('text');
}

function wrapObservableInPromise(obs) {
  return new Promise((res, rej) => {
    let out = '';

    obs.subscribe(
      (x) => out += x,
      (e) => rej(new Error(`${out}\n${e.message}`)),
      () => res(out));
  });
}

/**
 * Spawns a process but detached from the current process. The process is put
 * into its own Process Group.
 *
 * @param  {string} exe               The executable to run
 * @param  {Array<string>} params     The parameters to pass to the child
 * @param  {Object} opts              Options to pass to spawn.
 *
 * @return {Promise<string>}       Returns an Promise that represents a detached
 *                                 process. The value returned is the process
 *                                 output. If the process terminates with a
 *                                 non-zero value, the Promise will resolve with
 *                                 an Error.
 */
export function spawnDetachedPromise(exe, params, opts=null) {
  return wrapObservableInPromise(spawnDetached(exe, params, opts));
}


/**
 * Spawns a process as a child process.
 *
 * @param  {string} exe               The executable to run
 * @param  {Array<string>} params     The parameters to pass to the child
 * @param  {Object} opts              Options to pass to spawn.
 *
 * @return {Promise<string>}       Returns an Promise that represents a child
 *                                 process. The value returned is the process
 *                                 output. If the process terminates with a
 *                                 non-zero value, the Promise will resolve with
 *                                 an Error.
 */
export function spawnPromise(exe, params, opts=null) {
  return wrapObservableInPromise(spawn(exe, params, opts));
}