import { execOnHost, execSafe } from './execUtils';

const MIN_PORT = 1025;
const MAX_PORT = 9999;
export const getNextFreePorts = async (count: number): Promise<number[] | null> => {
    const occupiedPorts = await getOccupiedPorts();
    const freePorts: number[] = [];
    for (let port = MIN_PORT; port <= MAX_PORT; port++) {
        if (!occupiedPorts.includes(port)) {
            const isFree = await doubleCheckPortFree(port);
            if (!isFree) {
                await new Promise((r) => setTimeout(r, 10));
                continue;
            }
            freePorts.push(port);
            if (freePorts.length === count) {
                break;
            }
        }
    }
    return freePorts.length === count ? freePorts : null;
};

export const doubleCheckPortFree = async (port: number): Promise<boolean> => {
    if (process.env.PRODUCTION !== 'true') {
        console.log('Not in production mode, skipping port check');
        return true;
    }
    const cmd = `nc -w 2 -z 127.0.0.1 ${port} && echo "IN USE" || echo "FREE"`;
    try {
        const { out, code } = await execOnHost(cmd, 2000);
        return out.includes('FREE');
    } catch (error) {
        console.error('Error executing nc command', error);
        return false;
    }
};

export const getOccupiedPorts = async (): Promise<number[]> => {
    if (process.env.PRODUCTION !== 'true') {
        console.log('Not in production mode, skipping get ports');
        return [80, 443, 22, 1234]; // example ports
    }
    const occupiedPorts = new Set<number>();
    try {
        const { out, code } = await execOnHost('netstat --numeric-ports -ltu', 5000);
        if (code !== 0) {
            console.error('Error executing netstat command');
            return [];
        }
        const lines = out.split('\n');
        const bodyLines = lines.slice(2);
        for (const line of bodyLines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 4) {
                const localAddress = parts[3];
                const portMatch = localAddress.match(/:(\d+)$/);
                if (portMatch) {
                    const port = parseInt(portMatch[1], 10);
                    occupiedPorts.add(port);
                }
            }
        }
    } catch (error) {
        console.error(error);
    }
    return Array.from(occupiedPorts);
};
