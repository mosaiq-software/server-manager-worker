// This script executes entirely outside of the container

import * as util from 'util';
import * as child_process from 'child_process';
import * as fs from 'fs/promises';
const execAsync = util.promisify(child_process.exec);

const MAX_TIMEOUT = 1000 * 60 * 60; // 1 hour

const handleCommand = async (rawInput) => {
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
            instanceId: string,
            command: string,
            timeout: number | undefined
        }
    */

    const { instanceId, command, timeout } = data;
    console.log(`Executing command for instance ${instanceId}: ${command}`);
    if (!instanceId) {
        console.error("Invalid input data, missing instanceId:", data);
        return;
    }
    if (!command) {
        console.error("Invalid input data, missing command:", data);
        return;
    }

    const outDirPath = `${process.env.NSM_OUTPUT_PATH}`;
    const workingOutFilePath = `${outDirPath}/${instanceId}.out.working`;
    const outFilePath = `${outDirPath}/${instanceId}.out`;

    if (!command) {
        console.error("No command provided to execute.");
        return;
    }

    try {
        await fs.mkdir(outDirPath, { recursive: true });
    } catch (error) {
        console.error("Failed to create output directory:", error);
        return;
    }

    try {
        await fs.writeFile(workingOutFilePath, ``);
    } catch (error) {
        console.error("Failed to create working output file:", error);
        return;
    }

    const child = child_process.spawn(command, {
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    const realTimeout = timeout && typeof timeout === 'number' && timeout > 0 ? timeout : MAX_TIMEOUT;
    const timeoutId = setTimeout(() => {
        console.log(`Command timed out after ${realTimeout}ms`);
        child.kill();
    }, realTimeout);

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
        clearTimeout(timeoutId);
    });
}

const listenToPipe = async () => {
    console.log("Listening to pipe..." + process.env.NSM_PIPE_PATH);

    if (process.env.PRODUCTION !== 'true') {
        console.log("Not in production mode, skipping pipe listener.");
        return;
    }

    while (true) {
        const { out: pipeOut, code: pipeCode } = await execSafe(`cat ${process.env.NSM_PIPE_PATH}`);
        if (pipeCode === 0) {
            handleCommand(pipeOut);
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

/*
 * Get the process environment variables from ./.env file
 */
const loadProcessEnv = async () => {
    try {
        const env = await fs.readFile('./.env', 'utf-8');
        const lines = env.split('\n');
        for (const line of lines) {
            const [key, value] = line.split('=');
            if (key && value) {
                process.env[key.trim()] = value.trim();
            }
        }
    } catch (error) {
        console.error("Failed to read .env file:", error);
    }
};


// === STARTUP ===
await loadProcessEnv();
listenToPipe();