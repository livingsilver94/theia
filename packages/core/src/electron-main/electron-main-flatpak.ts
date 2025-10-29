import { OS } from '../common';
import { Path } from '../common/path';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';

/**
 * Escapes the Flatpak sandbox by re-executing the application outside of it.
 * This function does not return if successful, as the current process is replaced.
 * @throws Error if unable to escape the sandbox. This may happen if the
 * application is not running inside a Flatpak sandbox in the first place.
 */
export async function escapeSandbox() {
    let executable: Path;
    try {
        executable = (await appLocation()).join("files/bin/theia");
    } catch (err) {
        throw new Error(`Failed to get Flatpak application location: ${err}`);
    }
    const argsEnv = ["XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"]
        .filter(envvar => envvar in process.env)
        .map(envvar => `--env=${envvar}=${process.env[envvar]}`)
        // Should not be needed, but better safe than sorry. We don't want an infinite respawn.
        .concat("--unset-env=FLATPAK_ID");

    const args = ["--host"].concat(argsEnv, executable.toString());
    if ("execve" in process) {
        // execve is currently an experimental function in Node.JS.
        // This is the cleaner approach to replace the current process, but it may be
        // not available.
        (process as any).execve("/usr/bin/flatpak-spawn", args, process.env);
        // execve is supposed to replace the current process: if we are here, execve failed.
        throw new Error("Failed to escape the Flatpak sandbox");
    } else {
        // Alternatively to execve, we can fork + exit.
        // This is more resource intensive, but retro-compatible.
        const forked = new Promise<void>((resolve, reject) => {
            const result = spawn("/usr/bin/flatpak-spawn", args);
            result.on("spawn", () => { resolve(); });
            result.on("error", (_err) => { reject("Failed to escape the Flatpak sandbox"); });
        });
        try {
            await forked;
        } catch (err) {
            throw new Error(err);
        }
        process.exit(0);
    }
}

/**
 * Determines whether the application is running inside a Flatpak sandbox.
 * @returns `true` if running inside the sandbox, `false` otherwise.
 */
export function isInsideSandbox(): boolean {
    return OS.type() === OS.Type.Linux && process.env.FLATPAK_ID === FLATPAK_ID;
}

/**
 * Gets the path where the application's Flatpak is installed.
 * If the application is not installed as Flatpak, or it's not run inside
 * the Flatpak sandbox, the promise is rejected.
 * @returns Promise resolving to the application installation path.
 */
async function appLocation(): Promise<Path> {
    return new Promise((resolve, reject) => {
        let output: ChildProcessWithoutNullStreams;
        try {
            output = spawn(
                "/usr/bin/flatpak-spawn",
                [
                    "--host",
                    "flatpak",
                    "info",
                    "--show-location",
                    FLATPAK_ID,
                ]
            );
        } catch (err) {
            reject(err);
            return;
        }
        let path: Path;
        output.stdout.on("data", (data) => {
            path = new Path(data.toString().trimEnd());
        });
        output.on("close", (code: number) => {
            if (code === 0) {
                resolve(path);
            } else {
                reject("flatpak-spawn failed with code " + code);
            }
        });
    });
}

/**
 * The application ID within Flatpak.
 */
const FLATPAK_ID = "org.eclipse.theia";
