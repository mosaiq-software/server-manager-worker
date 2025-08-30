// This script executes entirely outside of the container

import * as util from 'util';
import * as child_process from 'child_process';
import * as fs from 'fs/promises';
const execAsync = util.promisify(child_process.exec);

const NSM_PIPE_PATH = "/etc/nsmexec";
const DEFAULT_TIMEOUT = 5 * 60 * 1000; // 5 minutes

const handleDeployer = async (rawInput) => {
    if (rawInput?.trim().length === 0) return;
    let data = {};
    try {
        data = JSON.parse(rawInput);
    } catch (error) {
        console.error("Failed to parse input data:", error, rawInput);
        return;
    }
    /*
        {
            projectId: string,
            instanceId: string,
            command: string,
            cleanup: boolean,
            timeout: number | undefined
        }
    */

    const { projectId, instanceId, command, cleanup, timeout } = data;
    console.log(`Executing command for project ${projectId}, instance ${instanceId}: ${command} (${cleanup ? 'cleanup' : 'execute'})`);
    if (!projectId || !instanceId) {
        console.error("Invalid input data, missing projectId or instanceId:", data);
        return;
    }
    if (!command && !cleanup) {
        console.error("Invalid input data, missing command or cleanup flag:", data);
        return;
    }

    const outDirPath = `/webapps/.nsm/${projectId}`;
    const workingOutFilePath = `${outDirPath}/${instanceId}.out.working`;
    const outFilePath = `${outDirPath}/${instanceId}.out`;

    if (cleanup) {
        try {

            fs.rm(outFilePath, { force: true, recursive: true });
            fs.rm(workingOutFilePath, { force: true, recursive: true });
        } catch (error) {
            console.error("Failed to clean up output file:", error);
        }
        return;
    }

    if (command) {
        try {
            await fs.mkdir(outDirPath, { recursive: true });
        } catch (error) {
            console.error("Failed to create output directory:", error);
            return;
        }

        try {
            await fs.writeFile(workingOutFilePath, `Project ID: ${projectId}\nInstance ID: ${instanceId}\nCommand: ${command}\nTimeout: ${timeout || DEFAULT_TIMEOUT}ms\n\n--- Output ---\n\n`);
        } catch (error) {
            console.error("Failed to create working output file:", error);
            return;
        }

        const child = child_process.spawn(command, {
            shell: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        console.log("this child was started by the command", child.pid, child.spawnargs);

        let timeoutId;
        if (timeout) {
            timeoutId = setTimeout(() => {
                console.log(`Command timed out after ${timeout}ms`);
                fs.appendFile(workingOutFilePath, `\n\n--- Command timed out after ${timeout}ms ---\n`, (err) => {
                    if (err) {
                        console.error("Failed to write timeout message to working output file:", err);
                    }
                });
                child.kill();
            }, timeout);
        }

        child.stdout.on('data', (data) => {
            fs.appendFile(workingOutFilePath, data.toString(), (err) => {
                if (err) {
                    console.error("Failed to write to working output file:", err);
                }
            });
        });

        child.stderr.on('data', (data) => {
            fs.appendFile(workingOutFilePath, data.toString(), (err) => {
                if (err) {
                    console.error("Failed to write to working output file:", err);
                }
            });
        });

        child.on('close', (code) => {
            console.log(`Child process exited with code ${code}`);
            fs.rename(workingOutFilePath, outFilePath).catch((err) => {
                console.error("Failed to rename working output file:", err);
            });
        });
    }

}

const listenToPipe = async () => {
    console.log("Listening to pipe..." + NSM_PIPE_PATH);
    while (true) {

        const { out: pipeOut, code: pipeCode } = await execSafe(`cat ${NSM_PIPE_PATH}`);
        if (pipeCode === 0) {
            handleDeployer(pipeOut);
        } else {
            console.error("Failed to read from pipe:", pipeOut);
        }
    }
}

const execSafe = async (command, timeoutms) => {
    let out = '';
    let code = 0;
    try {
        const co = await execAsync(command, { timeout: timeoutms });
        out += `${co.stdout}\n${co.stderr}\n`;
    } catch (error) {
        code = error.code ?? 1;
        out += `${error.stdout}\n${error.stderr}\n${error.message}`;
    }
    return { out, code };
}

listenToPipe();