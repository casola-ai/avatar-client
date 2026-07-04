import type { ConnectStrategy } from '../session';
export declare function connectViaToken(o: {
    connectUrl: string;
    sessionToken?: string;
    edgePaths?: {
        mse?: string;
        micStream?: string;
    };
    sessionCapSeconds?: number;
}): ConnectStrategy;
