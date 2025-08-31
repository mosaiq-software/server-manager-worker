export const verifyAuthToken = (token: string): boolean => {
    if (process.env.KEY && token === process.env.KEY) {
        return true;
    }
    return false;
};
