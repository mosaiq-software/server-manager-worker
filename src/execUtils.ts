import * as util from 'util';
import * as child_process from 'child_process';
import {existsSync, readFile} from "fs";
const execAsync = util.promisify(child_process.exec);

export interface HostExecMessage {
    projectId: string;
    instanceId: string;
    command: string;
    cleanup: boolean;
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