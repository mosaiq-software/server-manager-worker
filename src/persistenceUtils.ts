import * as fs from 'fs/promises';
export const getPersistentDirectories = async (relPaths: string[]): Promise<string[]> => {
    if (process.env.PRODUCTION !== 'true') {
        console.log('Not in production mode, returning mock directories');
        return relPaths.map((p) => `/mock/persistent/${p.replace(/^\/+/, '')}`);
    }
    const basePath = process.env.PERSISTENT_PATH;
    const fullPaths = relPaths.map((p) => `${basePath}/${p.replace(/^\/+/, '')}`);
    for (const path of fullPaths) {
        try {
            await fs.mkdir(path, { recursive: true });
        } catch (error) {
            console.error(`Error creating directory ${path}:`, error);
            throw error;
        }
    }
    return fullPaths;
};
