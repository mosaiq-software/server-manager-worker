import * as fs from 'fs/promises';
export const getPersistentDirectories = async (map: { [key: string]: { relPath: string } }): Promise<{ [key: string]: { fullPath: string } }> => {
    if (process.env.PRODUCTION !== 'true') {
        console.log('Not in production mode, returning mock directories');
        const mockBase = '/mock/persistent';
        const result: { [key: string]: { fullPath: string } } = {};
        for (const key in map) {
            result[key] = { fullPath: `${mockBase}/${map[key].relPath.replace(/^\/+/, '')}` };
        }
        return result;
    }
    const basePath = process.env.PERSISTENT_PATH;
    const fullPaths: { [key: string]: { fullPath: string } } = {};
    for (const key in map) {
        fullPaths[key] = { fullPath: `${basePath}/${map[key].relPath.replace(/^\/+/, '')}` };
    }
    for (const key in fullPaths) {
        const path = fullPaths[key].fullPath;
        try {
            await fs.mkdir(path, { recursive: true });
        } catch (error) {
            console.error(`Error creating directory ${path}:`, error);
            throw error;
        }
    }
    return fullPaths;
};
