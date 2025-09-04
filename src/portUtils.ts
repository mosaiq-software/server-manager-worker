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
        const {out, code} = await execOnHost('netstat --numeric-ports -ltu', 5000);
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

// Proto Recv-Q Send-Q Local Address           Foreign Address         State
// tcp        0      0 0.0.0.0:4125            0.0.0.0:*               LISTEN
// tcp        0      0 0.0.0.0:4126            0.0.0.0:*               LISTEN
// tcp        0      0 localhost:53            0.0.0.0:*               LISTEN
// tcp        0      0 localhost:14148         0.0.0.0:*               LISTEN
// tcp        0      0 0.0.0.0:2025            0.0.0.0:*               LISTEN
// tcp        0      0 0.0.0.0:443             0.0.0.0:*               LISTEN
// tcp        0      0 0.0.0.0:80              0.0.0.0:*               LISTEN
// tcp        0      0 0.0.0.0:22              0.0.0.0:*               LISTEN
// tcp        0      0 0.0.0.0:3100            0.0.0.0:*               LISTEN
// tcp        0      0 localhost:33345         0.0.0.0:*               LISTEN
// tcp        0      0 localhost:631           0.0.0.0:*               LISTEN
// tcp        0      0 nodenium140:25575       0.0.0.0:*               LISTEN
// tcp        0      0 localhost:5432          0.0.0.0:*               LISTEN
// tcp        0      0 localhost:5001          0.0.0.0:*               LISTEN
// tcp        0      0 localhost:5003          0.0.0.0:*               LISTEN
// tcp        0      0 0.0.0.0:9200            0.0.0.0:*               LISTEN
// tcp        0      0 0.0.0.0:9051            0.0.0.0:*               LISTEN
// tcp        0      0 0.0.0.0:9052            0.0.0.0:*               LISTEN
// tcp        0      0 0.0.0.0:9053            0.0.0.0:*               LISTEN
// tcp        0      0 localhost:8001          0.0.0.0:*               LISTEN
// tcp        0      0 localhost:8002          0.0.0.0:*               LISTEN
// tcp        0      0 localhost:8003          0.0.0.0:*               LISTEN
// tcp6       0      0 [::]:4125               [::]:*                  LISTEN
// tcp6       0      0 [::]:4126               [::]:*                  LISTEN
// tcp6       0      0 ip6-localhost:14148     [::]:*                  LISTEN
// tcp6       0      0 [::]:2025               [::]:*                  LISTEN
// tcp6       0      0 [::]:443                [::]:*                  LISTEN
// tcp6       0      0 [::]:33060              [::]:*                  LISTEN
// tcp6       0      0 [::]:80                 [::]:*                  LISTEN
// tcp6       0      0 [::]:22                 [::]:*                  LISTEN
// tcp6       0      0 [::]:3306               [::]:*                  LISTEN
// tcp6       0      0 [::]:3100               [::]:*                  LISTEN
// tcp6       0      0 [::]:9200               [::]:*                  LISTEN
// tcp6       0      0 [::]:25575              [::]:*                  LISTEN
// tcp6       0      0 [::]:9051               [::]:*                  LISTEN
// tcp6       0      0 [::]:9052               [::]:*                  LISTEN
// tcp6       0      0 [::]:9053               [::]:*                  LISTEN
// tcp6       0      0 ip6-localhost:631       [::]:*                  LISTEN
// udp        0      0 localhost:53            0.0.0.0:*
// udp        0      0 0.0.0.0:32821           0.0.0.0:*
// udp        0      0 nodenium140:68          0.0.0.0:*
// udp        0      0 0.0.0.0:5353            0.0.0.0:*
// udp6       0      0 nodenium140:546         [::]:*
// udp6       0      0 [::]:52155              [::]:*
// udp6       0      0 [::]:5353               [::]:*
