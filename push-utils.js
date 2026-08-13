import crypto from 'crypto';

const b64url = value => Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const fromB64url = value => Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function hkdfExtract(salt, ikm) {
    return crypto.createHmac('sha256', salt).update(ikm).digest();
}

function hkdfExpand(prk, info, length) {
    const blocks = [];
    let previous = Buffer.alloc(0);
    for (let counter = 1; Buffer.concat(blocks).length < length; counter++) {
        previous = crypto.createHmac('sha256', prk).update(Buffer.concat([previous, info, Buffer.from([counter])])).digest();
        blocks.push(previous);
    }
    return Buffer.concat(blocks).subarray(0, length);
}

function rawPublicKey(keyObject) {
    return Buffer.from(keyObject.export({ format: 'der', type: 'spki' })).subarray(-65);
}

function derToJose(signature) {
    let offset = 2;
    if (signature[1] & 0x80) offset += (signature[1] & 0x7f);
    if (signature[offset] !== 0x02) throw new Error('Invalid ECDSA signature');
    const rLength = signature[offset + 1];
    let r = signature.subarray(offset + 2, offset + 2 + rLength);
    offset += 2 + rLength;
    if (signature[offset] !== 0x02) throw new Error('Invalid ECDSA signature');
    const sLength = signature[offset + 1];
    let s = signature.subarray(offset + 2, offset + 2 + sLength);
    if (r.length > 32) r = r.subarray(r.length - 32);
    if (s.length > 32) s = s.subarray(s.length - 32);
    r = Buffer.concat([Buffer.alloc(32 - r.length), r]);
    s = Buffer.concat([Buffer.alloc(32 - s.length), s]);
    return Buffer.concat([r, s]);
}

export function createVapidKeys() {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = privateKey.export({ format: 'jwk' });
    return { privateJwk: jwk, publicKey: b64url(rawPublicKey(publicKey)) };
}

export function vapidJwt(endpoint, privateJwk, publicKey, subject = 'mailto:admin@example.com') {
    const audience = new URL(endpoint).origin;
    const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
    const payload = b64url(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: subject }));
    const data = `${header}.${payload}`;
    const privateKey = crypto.createPrivateKey({ key: privateJwk, format: 'jwk' });
    const signer = crypto.createSign('SHA256');
    signer.update(data);
    signer.end();
    const signature = derToJose(signer.sign(privateKey));
    return `${data}.${b64url(signature)}`;
}

export function encryptPayload(subscription, payload) {
    const clientPublicKey = fromB64url(subscription.keys.p256dh);
    const authSecret = fromB64url(subscription.keys.auth);
    const ephemeral = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const serverPublicKey = rawPublicKey(ephemeral.publicKey);
    const serverPrivateJwk = ephemeral.privateKey.export({ format: 'jwk' });
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(fromB64url(serverPrivateJwk.d));
    const sharedSecret = ecdh.computeSecret(clientPublicKey);

    const prk = hkdfExtract(authSecret, sharedSecret);
    const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), clientPublicKey, serverPublicKey]);
    const ikm = hkdfExpand(prk, keyInfo, 32);
    const salt = crypto.randomBytes(16);
    const contentPrk = hkdfExtract(salt, ikm);
    const cek = hkdfExpand(contentPrk, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
    const nonce = hkdfExpand(contentPrk, Buffer.from('Content-Encoding: nonce\0'), 12);
    const plaintext = Buffer.concat([Buffer.from(payload), Buffer.from([2])]);
    const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
    const recordSize = 4096;
    const header = Buffer.alloc(21);
    salt.copy(header, 0);
    header.writeUInt32BE(recordSize, 16);
    header[20] = serverPublicKey.length;
    return Buffer.concat([header, serverPublicKey, ciphertext]);
}

export async function sendWebPush(subscription, payload, vapid) {
    const body = encryptPayload(subscription, payload);
    const jwt = vapidJwt(subscription.endpoint, vapid.privateJwk, vapid.publicKey, vapid.subject);
    const response = await fetch(subscription.endpoint, {
        method: 'POST',
        headers: {
            'TTL': '86400',
            'Content-Type': 'application/octet-stream',
            'Content-Encoding': 'aes128gcm',
            'Authorization': `vapid t=${jwt}, k=${vapid.publicKey}`
        },
        body
    });
    if (!response.ok) {
        const text = await response.text();
        const error = new Error(`Push service returned ${response.status}: ${text}`);
        error.status = response.status;
        throw error;
    }
}
