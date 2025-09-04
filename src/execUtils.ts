import * as util from 'util';
import * as child_process from 'child_process';
import {existsSync} from "fs";
import * as pfs from 'fs/promises';
const execAsync = util.promisify(child_process.exec);

export interface HostExecMessage {
    instanceId: string;
    command: string;
    timeout: number | undefined;
}

const waitForFileExists = async (filePath:string, timeout:number, currentTime:number = 0) => {
    if (existsSync(filePath)) return true;
    if (currentTime >= timeout) return false;
    await new Promise((r) => setTimeout(() => r, 1000));
    return waitForFileExists(filePath, timeout, currentTime + 1000);
}

export const sendMessageToNsmExecutor = async (message: HostExecMessage): Promise<{out: string, code: number}> => {
    const pipePath = process.env.NSM_PIPE_PATH;

    const messageString = JSON.stringify(message).replace(`'`,`"`);

    let out = '';
    try {
        const {out:pipeOut, code:pipeCode} = await execSafe(`echo '${messageString}' > ${pipePath}`);
        out += pipeOut;
        if (pipeCode !== 0) {
            out += `\nError writing to pipe, code ${pipeCode}`;
            return {out, code: pipeCode};
        }
        return {out, code: 0};
    } catch (e:any) {
        out += `\nError executing command: ${e.message}`;
        return {out, code: 1};
    }
};

export const execOnHost = async (command:string, timeoutms:number, onStream?:(data:string) => void): Promise<{out: string, code: number}> => {
        try {
        // Send the command
        const messageInstanceId = crypto.randomUUID();
        const message: HostExecMessage = {
            instanceId: messageInstanceId,
            command: command,
            timeout: timeoutms,
        };
        const { out: execOut, code: execCode } = await sendMessageToNsmExecutor(message);
        if (execCode !== 0) {
            return { out: execOut, code: execCode };
        }

        // Stream in the output
        const outWorkingFilePath = `${process.env.NSM_OUTPUT_PATH}/${messageInstanceId}.out.working`;
        const outFilePath = `${process.env.NSM_OUTPUT_PATH}/${messageInstanceId}.out`;
        const startTime = Date.now();
        const maxEndTime = startTime + timeoutms + 2000;
        let fullOutput = '';
        let fileFound = false;
        while (true) {
            try {
                const workingContents = await pfs.readFile(outWorkingFilePath, 'utf-8');
                fileFound = true;
                if (workingContents.length > 0) {
                    await pfs.truncate(outWorkingFilePath, 0);
                    fullOutput += workingContents + '\n';
                    if (onStream) onStream(workingContents);
                }
            } catch (e) {
                if (fileFound) {
                    break;
                } else {
                    try {
                        // cmd finished before file was created, wait for it
                        const a = await pfs.readFile(outFilePath, 'utf-8');
                        break;
                    } catch (e) {
                        // continue waiting
                    }
                }
            }
            await new Promise((r) => setTimeout(r, 500));
            if (Date.now() > maxEndTime) {
                console.warn('Timed out waiting for output file from executor');
                break;
            }
        }
        try {
            await new Promise((r)=>r(setTimeout(r, 500)));
            const outFileContents = await pfs.readFile(outFilePath, 'utf-8');
            fullOutput += outFileContents;
            if (onStream) onStream(outFileContents);
        } catch (e) {
        }

        // Clean up the output
        try {
            pfs.rm(outWorkingFilePath, { recursive: true, force: true });
            pfs.rm(outFilePath, { recursive: true, force: true });
        } catch (e: any) {
            console.warn('Error cleaning up output files:', e);
        }

        return { out: fullOutput, code: 0 };
    } catch (e: any) {
        console.error('Error running host command:', command, e);
        throw new Error(`Error running host command: ${e.message}`);
    }
}

export const execSafe = async (command:string, timeoutms?:number): Promise<{out: string, code: number}> => {
    let out = '';
    let code = 0;
    try {
        const co = await execAsync(command, { timeout: timeoutms });
        out += `${co.stdout}\n${co.stderr}\n`;
    } catch (error:any) {
        code = error.code ?? 1;
        out += `${error.stdout}\n${error.stderr}\n${error.message}`;
    }
    return { out, code };
}