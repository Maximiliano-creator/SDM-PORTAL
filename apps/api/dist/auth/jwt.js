import jwt from 'jsonwebtoken';
import { config } from '../config.js';
export function signToken(payload, sessionId) {
    const options = { expiresIn: config.jwtExpiresIn };
    const token = jwt.sign({ ...payload, sid: sessionId }, config.jwtSecret, {
        ...options,
        algorithm: 'HS256',
    });
    const decoded = jwt.decode(token);
    const expiresAt = decoded?.exp ? new Date(decoded.exp * 1000).toISOString() : '';
    return { token, expiresAt };
}
export function verifyToken(token) {
    try {
        const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
        if (typeof decoded === 'string')
            return null;
        const { sub, username, role, sid } = decoded;
        if (typeof sub !== 'number' ||
            typeof username !== 'string' ||
            typeof sid !== 'string' ||
            (role !== 'admin' && role !== 'operator')) {
            return null;
        }
        return { sub, username, role, sid };
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=jwt.js.map