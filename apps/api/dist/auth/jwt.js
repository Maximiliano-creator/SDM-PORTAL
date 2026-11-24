import jwt from 'jsonwebtoken';
import { config } from '../config.js';
export function signToken(payload) {
    const options = { expiresIn: config.jwtExpiresIn };
    const token = jwt.sign(payload, config.jwtSecret, options);
    const decoded = jwt.decode(token);
    const expiresAt = decoded?.exp ? new Date(decoded.exp * 1000).toISOString() : '';
    return { token, expiresAt };
}
export function verifyToken(token) {
    try {
        const decoded = jwt.verify(token, config.jwtSecret);
        if (typeof decoded === 'string')
            return null;
        const { sub, username, role } = decoded;
        if (typeof sub !== 'number' || typeof username !== 'string' || (role !== 'admin' && role !== 'operator')) {
            return null;
        }
        return { sub, username, role };
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=jwt.js.map